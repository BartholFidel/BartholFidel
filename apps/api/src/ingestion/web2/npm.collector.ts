import type { Entity } from "@bartholfidel/shared";
import { listNpmWatchlistEntities } from "../../repositories/entities.repository.js";
import {
  insertEntityMetricsBatch,
  insertRawEventIfNew,
} from "../../repositories/ingestion.repository.js";

const NPM_REGISTRY_RSS = "https://registry.npmjs.org/-/rss";
const NPM_PACKAGE_URL = "https://registry.npmjs.org";

/** npm packument version entry (subset of registry JSON) */
interface NpmVersionDist {
  tarball?: string;
  shasum?: string;
  size?: number;
  unpackedSize?: number;
}

interface NpmVersionScripts {
  preinstall?: string;
  postinstall?: string;
}

interface NpmVersionDoc {
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: NpmVersionScripts;
  dist?: NpmVersionDist;
}

interface NpmPackument {
  name: string;
  maintainers?: unknown[];
  time?: Record<string, string>;
  versions: Record<string, NpmVersionDoc>;
}

export interface NpmCollectorResult {
  rssFetched: boolean;
  entitiesProcessed: number;
  eventsInserted: number;
  metricsInserted: number;
}

interface VersionMetricRow {
  entityId: string;
  version: string;
  metric: string;
  value: number;
  timestamp: Date;
}

/**
 * Polls the npm registry RSS feed (scheduled trigger) and ingests
 * full packuments for every package on the web2 npm watchlist.
 */
export async function runNpmCollector(): Promise<NpmCollectorResult> {
  const rssFetched = await pollNpmRss();
  const watchlist = await listNpmWatchlistEntities();

  let eventsInserted = 0;
  let metricsInserted = 0;

  for (const entity of watchlist) {
    const outcome = await collectPackageForEntity(entity);
    eventsInserted += outcome.eventsInserted;
    metricsInserted += outcome.metricsInserted;
  }

  console.log(
    `[npm-collector] rss=${rssFetched} entities=${watchlist.length} events=${eventsInserted} metrics=${metricsInserted}`,
  );

  return {
    rssFetched,
    entitiesProcessed: watchlist.length,
    eventsInserted,
    metricsInserted,
  };
}

/** Fetches the npm registry RSS feed (5-minute poll trigger). */
async function pollNpmRss(): Promise<boolean> {
  try {
    const response = await fetch(NPM_REGISTRY_RSS, {
      headers: { Accept: "application/rss+xml, application/xml, text/xml" },
    });
    if (!response.ok) {
      console.warn(`[npm-collector] RSS poll failed: HTTP ${response.status}`);
      return false;
    }
    await response.text();
    return true;
  } catch (error) {
    console.warn("[npm-collector] RSS poll error:", error);
    return false;
  }
}

async function collectPackageForEntity(
  entity: Entity,
): Promise<{ eventsInserted: number; metricsInserted: number }> {
  const packument = await fetchPackument(entity.name);
  if (!packument) {
    return { eventsInserted: 0, metricsInserted: 0 };
  }

  const modifiedAt = packument.time?.modified
    ? new Date(packument.time.modified)
    : null;

  const inserted = await insertRawEventIfNew({
    entityId: entity.id,
    eventType: "npm_packument",
    source: "web2",
    eventTimestamp: modifiedAt,
    payload: packument,
  });

  const metricRows = buildVersionMetrics(entity.id, packument);

  // Only persist metrics when the packument is new (deduped by payload_hash)
  if (inserted && metricRows.length > 0) {
    await insertEntityMetricsBatch(metricRows);
  }

  return {
    eventsInserted: inserted ? 1 : 0,
    metricsInserted: inserted ? metricRows.length : 0,
  };
}

/**
 * Fetches a package's direct runtime dependencies (latest published version).
 * Used by relationship inference to build DEPENDS_ON edges.
 */
export async function fetchDirectDependencies(
  packageName: string,
): Promise<string[]> {
  const packument = await fetchPackument(packageName);
  if (!packument) {
    return [];
  }
  const latest = latestVersionDoc(packument);
  return latest ? Object.keys(latest.dependencies ?? {}) : [];
}

/** Picks the most recently published version document in a packument. */
function latestVersionDoc(packument: NpmPackument): NpmVersionDoc | null {
  let newest: { doc: NpmVersionDoc; at: number } | null = null;
  for (const [version, doc] of Object.entries(packument.versions)) {
    const timeRaw = packument.time?.[version];
    const at = timeRaw ? new Date(timeRaw).getTime() : Number.NaN;
    if (Number.isNaN(at)) {
      continue;
    }
    if (!newest || at > newest.at) {
      newest = { doc, at };
    }
  }
  return newest?.doc ?? null;
}

async function fetchPackument(packageName: string): Promise<NpmPackument | null> {
  const encoded = encodeURIComponent(packageName);
  const url = `${NPM_PACKAGE_URL}/${encoded}`;

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      console.warn(
        `[npm-collector] packument fetch failed for ${packageName}: HTTP ${response.status}`,
      );
      return null;
    }
    const data: unknown = await response.json();
    return parsePackument(data, packageName);
  } catch (error) {
    console.warn(`[npm-collector] packument fetch error for ${packageName}:`, error);
    return null;
  }
}

function parsePackument(data: unknown, fallbackName: string): NpmPackument | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const record = data as Record<string, unknown>;
  if (typeof record.versions !== "object" || record.versions === null) {
    return null;
  }

  const maintainers = Array.isArray(record.maintainers)
    ? record.maintainers
    : [];

  const time =
    typeof record.time === "object" && record.time !== null
      ? (record.time as Record<string, string>)
      : {};

  const versions = record.versions as Record<string, NpmVersionDoc>;

  return {
    name: typeof record.name === "string" ? record.name : fallbackName,
    maintainers,
    time,
    versions,
  };
}

/**
 * Builds metric rows for each published version in the packument.
 */
function buildVersionMetrics(
  entityId: string,
  packument: NpmPackument,
): VersionMetricRow[] {
  const maintainerCount = packument.maintainers?.length ?? 0;
  const versionTimes = buildSortedVersionTimes(packument);
  const rows: VersionMetricRow[] = [];

  for (const { version, publishedAt, previousPublishedAt } of versionTimes) {
    const versionDoc = packument.versions[version];
    if (!versionDoc) {
      continue;
    }

    const publishIntervalHours = computePublishIntervalHours(
      publishedAt,
      previousPublishedAt,
    );
    const packageSizeKb = computePackageSizeKb(versionDoc);
    const hasInstallScript = hasInstallScriptFlag(versionDoc);
    const dependencyCount = countDirectDependencies(versionDoc);

    const base = { entityId, version, timestamp: publishedAt };

    rows.push(
      {
        ...base,
        metric: `publish_interval_hours:${version}`,
        value: publishIntervalHours,
      },
      {
        ...base,
        metric: `maintainer_count:${version}`,
        value: maintainerCount,
      },
      {
        ...base,
        metric: `package_size_kb:${version}`,
        value: packageSizeKb,
      },
      {
        ...base,
        metric: `has_install_script:${version}`,
        value: hasInstallScript ? 1 : 0,
      },
      {
        ...base,
        metric: `dependency_count:${version}`,
        value: dependencyCount,
      },
    );
  }

  return rows;
}

interface VersionTimeEntry {
  version: string;
  publishedAt: Date;
  previousPublishedAt: Date | null;
}

function buildSortedVersionTimes(packument: NpmPackument): VersionTimeEntry[] {
  const entries: Array<{ version: string; publishedAt: Date }> = [];

  for (const version of Object.keys(packument.versions)) {
    const timeRaw = packument.time?.[version];
    if (!timeRaw) {
      continue;
    }
    const publishedAt = new Date(timeRaw);
    if (Number.isNaN(publishedAt.getTime())) {
      continue;
    }
    entries.push({ version, publishedAt });
  }

  entries.sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());

  return entries.map((entry, index) => ({
    version: entry.version,
    publishedAt: entry.publishedAt,
    previousPublishedAt:
      index > 0 ? (entries[index - 1]?.publishedAt ?? null) : null,
  }));
}

function computePublishIntervalHours(
  publishedAt: Date,
  previousPublishedAt: Date | null,
): number {
  if (!previousPublishedAt) {
    return 0;
  }
  const diffMs = publishedAt.getTime() - previousPublishedAt.getTime();
  return Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100;
}

function computePackageSizeKb(versionDoc: NpmVersionDoc): number {
  const dist = versionDoc.dist;
  if (!dist) {
    return 0;
  }
  // Prefer compressed tarball size when published by the registry
  const bytes =
    typeof dist.size === "number"
      ? dist.size
      : typeof dist.unpackedSize === "number"
        ? dist.unpackedSize
        : 0;
  return Math.round((bytes / 1024) * 100) / 100;
}

function hasInstallScriptFlag(versionDoc: NpmVersionDoc): boolean {
  const scripts = versionDoc.scripts;
  if (!scripts) {
    return false;
  }
  return Boolean(scripts.preinstall ?? scripts.postinstall);
}

function countDirectDependencies(versionDoc: NpmVersionDoc): number {
  return Object.keys(versionDoc.dependencies ?? {}).length;
}
