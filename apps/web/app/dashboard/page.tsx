import type { Entity, HealthCheckResponse, IncidentTierCounts } from "@bartholfidel/shared";
import Link from "next/link";

async function fetchHealth(): Promise<HealthCheckResponse | null> {
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.VERCEL_URL ??
    "http://localhost:3000";
  const origin = baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`;

  try {
    const res = await fetch(`${origin}/api/health`, { cache: "no-store" });
    if (!res.ok) {
      return null;
    }
    const data: unknown = await res.json();
    if (
      typeof data === "object" &&
      data !== null &&
      "success" in data &&
      (data as HealthCheckResponse).success === true
    ) {
      return data as HealthCheckResponse;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchEntityCount(): Promise<number> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  try {
    const res = await fetch(`${apiUrl}/api/entities`, { cache: "no-store" });
    if (!res.ok) {
      return 0;
    }
    const data: unknown = await res.json();
    if (
      typeof data === "object" &&
      data !== null &&
      "success" in data &&
      (data as { success: boolean }).success === true &&
      "data" in data &&
      Array.isArray((data as { data: Entity[] }).data)
    ) {
      return (data as { data: Entity[] }).data.length;
    }
    return 0;
  } catch {
    return 0;
  }
}

async function fetchIncidentCounts(): Promise<IncidentTierCounts> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  try {
    const res = await fetch(`${apiUrl}/api/incidents/counts`, {
      cache: "no-store",
    });
    if (!res.ok) {
      return { info: 0, warning: 0, critical: 0 };
    }
    const data: unknown = await res.json();
    if (
      typeof data === "object" &&
      data !== null &&
      "success" in data &&
      (data as { success: boolean }).success === true &&
      "data" in data
    ) {
      return (data as { data: IncidentTierCounts }).data;
    }
    return { info: 0, warning: 0, critical: 0 };
  } catch {
    return { info: 0, warning: 0, critical: 0 };
  }
}

export default async function DashboardPage(): Promise<JSX.Element> {
  const [health, entityCount, incidentCounts] = await Promise.all([
    fetchHealth(),
    fetchEntityCount(),
    fetchIncidentCounts(),
  ]);
  const isOnline = health?.success === true;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-2xl rounded-xl border border-surface-border bg-surface-raised p-10 shadow-2xl shadow-black/40">
        <header className="mb-8 text-center">
          <p className="mb-2 font-mono text-xs uppercase tracking-[0.3em] text-accent">
            Threat Prevention Platform
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-white">
            BartholFidel
          </h1>
        </header>

        <div
          className={`mb-6 flex items-center justify-center gap-3 rounded-lg border px-6 py-4 ${
            isOnline
              ? "border-status-online/30 bg-status-online/10"
              : "border-status-offline/30 bg-status-offline/10"
          }`}
        >
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              isOnline
                ? "animate-pulse bg-status-online shadow-[0_0_12px_#10b981]"
                : "bg-status-offline"
            }`}
            aria-hidden
          />
          <p className="text-lg font-medium">
            {isOnline ? "System Online" : "System Offline"}
          </p>
        </div>

        <div className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-mono text-xs uppercase tracking-wide text-gray-500">
              Active Incidents
            </p>
            <Link
              href="/incidents"
              className="text-sm text-accent hover:text-accent-muted"
            >
              View all →
            </Link>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-center">
              <p className="font-mono text-xs uppercase text-blue-400">Info</p>
              <p className="mt-1 text-2xl font-semibold text-white">
                {incidentCounts.info}
              </p>
            </div>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-center">
              <p className="font-mono text-xs uppercase text-amber-400">
                Warning
              </p>
              <p className="mt-1 text-2xl font-semibold text-white">
                {incidentCounts.warning}
              </p>
            </div>
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-center">
              <p className="font-mono text-xs uppercase text-red-400">
                Critical
              </p>
              <p className="mt-1 text-2xl font-semibold text-white">
                {incidentCounts.critical}
              </p>
            </div>
          </div>
        </div>

        <div className="mb-6 rounded-lg border border-surface-border bg-surface/50 px-6 py-4 text-center">
          <p className="font-mono text-xs uppercase tracking-wide text-gray-500">
            Entities Monitored
          </p>
          <p className="mt-1 text-3xl font-semibold text-white">{entityCount}</p>
          <Link
            href="/entities"
            className="mt-3 inline-block text-sm text-accent hover:text-accent-muted"
          >
            View entity watchlist →
          </Link>
        </div>

        <div className="mb-6 rounded-lg border border-surface-border bg-surface/50 px-6 py-4 text-center">
          <p className="font-mono text-xs uppercase tracking-wide text-gray-500">
            Relationship Graph
          </p>
          <p className="mt-1 text-sm text-gray-400">
            Explore how entities connect — deployments, dependencies, and
            cross-surface links.
          </p>
          <Link
            href="/graph"
            className="mt-3 inline-block text-sm text-accent hover:text-accent-muted"
          >
            Open relationship graph →
          </Link>
        </div>

        {entityCount === 0 && (
          <p className="mb-4 text-center text-sm text-gray-400">
            Add your first entity to begin monitoring.{" "}
            <Link href="/entities" className="text-accent hover:underline">
              Go to entities
            </Link>
          </p>
        )}

        {health?.timestamp && (
          <p className="text-center font-mono text-xs text-gray-500">
            Last check: {health.timestamp}
          </p>
        )}
      </div>
    </main>
  );
}
