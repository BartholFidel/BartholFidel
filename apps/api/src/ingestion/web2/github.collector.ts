import { createHmac, timingSafeEqual } from "node:crypto";
import type { Entity } from "@bartholfidel/shared";
import {
  evaluateSupplyChain001,
  evaluateSupplyChain002,
} from "../../alerts/supply-chain.js";
import {
  insertEntityMetric,
  insertRawEventIfNew,
} from "../../repositories/ingestion.repository.js";
import {
  findGitHubEntityByFullName,
  listGitHubWatchlistEntities,
  parseGitHubConfig,
  updateEntityConfig,
  type GitHubRepoConfig,
} from "../../repositories/github.repository.js";

const GITHUB_API = "https://api.github.com";

/** Domains commonly present in GitHub Actions that are not supply-chain signals */
const TRUSTED_DOMAINS = new Set([
  "github.com",
  "api.github.com",
  "githubusercontent.com",
  "actions.githubusercontent.com",
  "registry.npmjs.org",
  "nodejs.org",
]);

export interface GitHubWebhookResult {
  accepted: boolean;
  eventType: string;
  entityId?: string;
  message?: string;
}

export interface GitHubPollerResult {
  entitiesProcessed: number;
  metricsRecorded: number;
}

/** Validates X-Hub-Signature-256 against the raw request body */
export function verifyGitHubSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) {
    return false;
  }
  const expected =
    "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

/**
 * Entry point for POST /api/webhooks/github
 */
export async function handleGitHubWebhook(params: {
  rawBody: Buffer;
  eventType: string;
  deliveryId: string;
  payload: unknown;
}): Promise<GitHubWebhookResult> {
  const eventType = params.eventType;

  const fullName = extractRepositoryFullName(params.payload);
  if (!fullName) {
    return { accepted: true, eventType, message: "No repository in payload" };
  }

  const entity = await findGitHubEntityByFullName(fullName);
  if (!entity) {
    return {
      accepted: true,
      eventType,
      message: `No watchlist entity for ${fullName}`,
    };
  }

  const cfg = parseGitHubConfig(entity.config);
  if (!cfg) {
    return { accepted: false, eventType, message: "Invalid entity config" };
  }

  if (eventType === "workflow_run" && !cfg.watch_actions) {
    return { accepted: true, eventType, message: "watch_actions disabled" };
  }

  await insertRawEventIfNew({
    entityId: entity.id,
    eventType: `github_${eventType}`,
    source: "web2",
    eventTimestamp: new Date(),
    payload: {
      delivery_id: params.deliveryId,
      event: eventType,
      body: params.payload,
    },
  });

  switch (eventType) {
    case "push":
      await processPushEvent(entity, cfg, params.payload);
      break;
    case "workflow_run":
      await processWorkflowRunEvent(entity, params.payload);
      break;
    case "member":
      await processMemberEvent(entity, params.payload);
      break;
    case "repository":
      await processRepositoryEvent(entity, params.payload);
      break;
    default:
      break;
  }

  return { accepted: true, eventType, entityId: entity.id };
}

/** Hourly REST poll for collaborators and workflows */
export async function runGitHubPoller(githubToken: string): Promise<GitHubPollerResult> {
  const entities = await listGitHubWatchlistEntities();
  let metricsRecorded = 0;

  for (const entity of entities) {
    const cfg = parseGitHubConfig(entity.config);
    if (!cfg) {
      continue;
    }

    const recorded = await pollRepository(entity, cfg, githubToken);
    metricsRecorded += recorded;
  }

  console.log(
    `[github-poller] entities=${entities.length} metrics=${metricsRecorded}`,
  );

  return { entitiesProcessed: entities.length, metricsRecorded };
}

async function pollRepository(
  entity: Entity,
  cfg: GitHubRepoConfig,
  token: string,
): Promise<number> {
  let recorded = 0;
  const headers = githubHeaders(token);
  const now = new Date();

  const collaborators = await githubGet<unknown[]>(
    `${GITHUB_API}/repos/${cfg.owner}/${cfg.repo}/collaborators`,
    headers,
  );

  if (collaborators) {
    const count = collaborators.length;
    const prev = cfg.github_last_collaborator_count ?? count;
    if (count > prev) {
      await insertEntityMetric({
        entityId: entity.id,
        metric: "new_collaborator_added",
        value: 1,
        timestamp: now,
      });
      await insertEntityMetric({
        entityId: entity.id,
        metric: "permission_change_frequency",
        value: count - prev,
        timestamp: now,
      });
      recorded += 2;
      await evaluateSupplyChain001(entity.id);
    }

    cfg.github_last_collaborator_count = count;
  }

  if (cfg.watch_actions) {
    const workflows = await githubGet<GitHubWorkflowsResponse>(
      `${GITHUB_API}/repos/${cfg.owner}/${cfg.repo}/actions/workflows`,
      headers,
    );

    if (workflows) {
      const count = workflows.total_count;
      const prev = cfg.github_last_workflow_count ?? count;
      const latestModified = workflows.workflows.reduce((max, wf) => {
        const t = new Date(wf.updated_at).getTime();
        return t > max ? t : max;
      }, 0);

      const prevModified =
        typeof entity.config.github_last_workflow_modified === "number"
          ? (entity.config.github_last_workflow_modified as number)
          : 0;

      if (count !== prev || latestModified > prevModified) {
        await insertEntityMetric({
          entityId: entity.id,
          metric: "action_workflow_changed",
          value: 1,
          timestamp: now,
        });
        recorded += 1;
        await evaluateSupplyChain001(entity.id);
      }

      cfg.github_last_workflow_count = count;
      entity.config.github_last_workflow_modified = latestModified;
    }
  }

  await updateEntityConfig(entity.id, {
    ...entity.config,
    ...cfg,
    github_last_workflow_modified: entity.config.github_last_workflow_modified,
  });

  return recorded;
}

interface GitHubWorkflowsResponse {
  total_count: number;
  workflows: Array<{
    id: number;
    path: string;
    state: string;
    created_at: string;
    updated_at: string;
  }>;
}

async function processPushEvent(
  entity: Entity,
  cfg: GitHubRepoConfig,
  payload: unknown,
): Promise<void> {
  if (typeof payload !== "object" || payload === null) {
    return;
  }
  const record = payload as Record<string, unknown>;
  const commits = Array.isArray(record.commits) ? record.commits : [];
  const ref = typeof record.ref === "string" ? record.ref : "";
  const branch = ref.replace("refs/heads/", "");
  const afterSha = typeof record.after === "string" ? record.after : "";

  const commitCount = commits.length;
  const authors = commits
    .map((c) => {
      if (typeof c !== "object" || c === null) {
        return null;
      }
      const commit = c as Record<string, unknown>;
      const author = commit.author;
      if (typeof author === "object" && author !== null) {
        const name = (author as Record<string, unknown>).name;
        return typeof name === "string" ? name : null;
      }
      return null;
    })
    .filter((name): name is string => name !== null);

  const workflowPaths = collectWorkflowPathsFromCommits(commits);
  const workflowChanged = workflowPaths.length > 0;
  const now = new Date();

  await insertEntityMetric({
    entityId: entity.id,
    metric: "commit_frequency_per_day",
    value: commitCount,
    timestamp: now,
  });

  if (workflowChanged) {
    await insertEntityMetric({
      entityId: entity.id,
      metric: "action_workflow_changed",
      value: 1,
      timestamp: now,
    });
  }

  const token = process.env.GITHUB_TOKEN;
  let newDomains: string[] = [];

  if (workflowChanged && token && afterSha) {
    newDomains = await detectNewWorkflowDomains({
      owner: cfg.owner,
      repo: cfg.repo,
      ref: afterSha,
      workflowPaths,
      entity,
      token,
    });
  } else if (workflowChanged) {
    // Webhook replay / simulation when file contents are not fetched
    newDomains = detectDomainsInPayload(payload, entity, workflowPaths);
    if (newDomains.length > 0) {
      await updateEntityConfig(entity.id, entity.config);
    }
  }

  if (newDomains.length > 0 && workflowChanged) {
    await evaluateSupplyChain002({
      entityId: entity.id,
      newDomains,
      workflowPaths,
    });
  }

  await evaluateSupplyChain001(entity.id);

  console.log(
    `[github] push entity=${entity.id} commits=${commitCount} branch=${branch} authors=${authors.length} workflow_changed=${workflowChanged ? 1 : 0}`,
  );
}

async function processWorkflowRunEvent(
  entity: Entity,
  payload: unknown,
): Promise<void> {
  if (typeof payload !== "object" || payload === null) {
    return;
  }
  const record = payload as Record<string, unknown>;
  const workflowRun = record.workflow_run;
  if (typeof workflowRun !== "object" || workflowRun === null) {
    return;
  }

  const run = workflowRun as Record<string, unknown>;
  const name = typeof run.name === "string" ? run.name : "unknown";
  const conclusion = typeof run.conclusion === "string" ? run.conclusion : "unknown";
  const started = typeof run.run_started_at === "string" ? run.run_started_at : null;
  const updated = typeof run.updated_at === "string" ? run.updated_at : null;

  let durationSeconds = 0;
  if (started && updated) {
    durationSeconds = Math.max(
      0,
      (new Date(updated).getTime() - new Date(started).getTime()) / 1000,
    );
  }

  const externalDomains = extractDomainsFromWorkflowRun(run);

  await insertEntityMetric({
    entityId: entity.id,
    metric: "action_workflow_changed",
    value: 1,
    timestamp: new Date(),
  });

  console.log(
    `[github] workflow_run entity=${entity.id} name=${name} conclusion=${conclusion} duration_s=${durationSeconds} domains=${externalDomains.join(",")}`,
  );
}

async function processMemberEvent(
  entity: Entity,
  payload: unknown,
): Promise<void> {
  if (typeof payload !== "object" || payload === null) {
    return;
  }
  const record = payload as Record<string, unknown>;
  const action = typeof record.action === "string" ? record.action : "";
  const member = record.member;
  const login =
    typeof member === "object" &&
    member !== null &&
    typeof (member as Record<string, unknown>).login === "string"
      ? ((member as Record<string, unknown>).login as string)
      : "unknown";

  const now = new Date();

  await insertEntityMetric({
    entityId: entity.id,
    metric: "permission_change_frequency",
    value: 1,
    timestamp: now,
  });

  if (action === "added") {
    await insertEntityMetric({
      entityId: entity.id,
      metric: "new_collaborator_added",
      value: 1,
      timestamp: now,
    });
    await evaluateSupplyChain001(entity.id);
  }

  console.log(`[github] member entity=${entity.id} action=${action} login=${login}`);
}

async function processRepositoryEvent(
  entity: Entity,
  payload: unknown,
): Promise<void> {
  if (typeof payload !== "object" || payload === null) {
    return;
  }
  const record = payload as Record<string, unknown>;
  const action = typeof record.action === "string" ? record.action : "";
  const repository = record.repository;
  const visibility =
    typeof repository === "object" &&
    repository !== null &&
    typeof (repository as Record<string, unknown>).visibility === "string"
      ? ((repository as Record<string, unknown>).visibility as string)
      : "unknown";

  await insertEntityMetric({
    entityId: entity.id,
    metric: "permission_change_frequency",
    value: 1,
    timestamp: new Date(),
  });

  console.log(
    `[github] repository entity=${entity.id} action=${action} visibility=${visibility}`,
  );
}

function extractRepositoryFullName(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const repository = record.repository;
  if (typeof repository === "object" && repository !== null) {
    const fullName = (repository as Record<string, unknown>).full_name;
    if (typeof fullName === "string") {
      return fullName;
    }
  }
  return null;
}

function collectWorkflowPathsFromCommits(commits: unknown[]): string[] {
  const paths = new Set<string>();
  for (const commit of commits) {
    if (typeof commit !== "object" || commit === null) {
      continue;
    }
    const c = commit as Record<string, unknown>;
    for (const field of ["added", "modified", "removed"]) {
      const files = c[field];
      if (!Array.isArray(files)) {
        continue;
      }
      for (const file of files) {
        if (typeof file === "string" && isWorkflowPath(file)) {
          paths.add(file);
        }
      }
    }
  }
  return [...paths];
}

function isWorkflowPath(filePath: string): boolean {
  return (
    filePath.startsWith(".github/workflows/") &&
    (filePath.endsWith(".yml") || filePath.endsWith(".yaml"))
  );
}

export function extractDomainsFromText(content: string): string[] {
  const domains = new Set<string>();
  const urlPattern = /https?:\/\/([a-zA-Z0-9][-a-zA-Z0-9.]*[a-zA-Z0-9])/gi;
  let match = urlPattern.exec(content);
  while (match) {
    const host = match[1]?.toLowerCase();
    if (host && !TRUSTED_DOMAINS.has(host)) {
      domains.add(host);
    }
    match = urlPattern.exec(content);
  }
  return [...domains];
}

function extractDomainsFromWorkflowRun(run: Record<string, unknown>): string[] {
  const text = JSON.stringify(run);
  return extractDomainsFromText(text);
}

async function detectNewWorkflowDomains(params: {
  owner: string;
  repo: string;
  ref: string;
  workflowPaths: string[];
  entity: Entity;
  token: string;
}): Promise<string[]> {
  const cfg = parseGitHubConfig(params.entity.config);
  const knownByPath = cfg?.github_workflow_domains ?? {};
  const allNew: string[] = [];
  const updatedKnown: Record<string, string[]> = { ...knownByPath };

  for (const filePath of params.workflowPaths) {
    const content = await fetchWorkflowFileContent(
      params.owner,
      params.repo,
      filePath,
      params.ref,
      params.token,
    );
    if (!content) {
      continue;
    }

    const domains = extractDomainsFromText(content);
    const previous = new Set(knownByPath[filePath] ?? []);
    const added = domains.filter((d) => !previous.has(d));

    if (added.length > 0) {
      allNew.push(...added);
    }

    updatedKnown[filePath] = domains;
  }

  await updateEntityConfig(params.entity.id, {
    ...params.entity.config,
    github_workflow_domains: updatedKnown,
  });

  return [...new Set(allNew)];
}

/** Detect new external domains embedded in webhook JSON (e.g. test simulations) */
function detectDomainsInPayload(
  payload: unknown,
  entity: Entity,
  workflowPaths: string[],
): string[] {
  const cfg = parseGitHubConfig(entity.config);
  const knownByPath = cfg?.github_workflow_domains ?? {};
  const knownFlat = new Set(Object.values(knownByPath).flat());
  const found = extractDomainsFromText(JSON.stringify(payload));
  const added = found.filter((d) => !knownFlat.has(d));
  if (added.length > 0 && workflowPaths[0]) {
    const path = workflowPaths[0];
    const updatedDomains = {
      ...knownByPath,
      [path]: [...(knownByPath[path] ?? []), ...added],
    };
    entity.config = {
      ...entity.config,
      github_workflow_domains: updatedDomains,
    };
  }
  return added;
}

async function fetchWorkflowFileContent(
  owner: string,
  repo: string,
  path: string,
  ref: string,
  token: string,
): Promise<string | null> {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodedPath}?ref=${ref}`;
  const data = await githubGet<{ content?: string; encoding?: string }>(
    url,
    githubHeaders(token),
  );
  if (!data?.content || data.encoding !== "base64") {
    return null;
  }
  return Buffer.from(data.content, "base64").toString("utf8");
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function githubGet<T>(url: string, headers: Record<string, string>): Promise<T | null> {
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      console.warn(`[github] API ${url} failed: HTTP ${response.status}`);
      return null;
    }
    return (await response.json()) as T;
  } catch (error) {
    console.warn(`[github] API error ${url}:`, error);
    return null;
  }
}
