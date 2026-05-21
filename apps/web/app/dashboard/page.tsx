import type { HealthCheckResponse } from "@bartholfidel/shared";

/** Fetches API health from the Next.js rewrite proxy (/api → Express). */
async function fetchHealth(): Promise<HealthCheckResponse | null> {
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.VERCEL_URL ??
    "http://localhost:3000";
  const origin = baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`;

  try {
    const res = await fetch(`${origin}/api/health`, {
      cache: "no-store",
    });
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

export default async function DashboardPage(): Promise<JSX.Element> {
  const health = await fetchHealth();
  const isOnline = health?.success === true;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="w-full max-w-lg rounded-xl border border-surface-border bg-surface-raised p-10 shadow-2xl shadow-black/40">
        <header className="mb-8 text-center">
          <p className="mb-2 font-mono text-xs uppercase tracking-[0.3em] text-accent">
            Threat Prevention Platform
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-white">
            BartholFidel
          </h1>
        </header>

        <div
          className={`flex items-center justify-center gap-3 rounded-lg border px-6 py-4 ${
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

        {health?.timestamp && (
          <p className="mt-6 text-center font-mono text-xs text-gray-500">
            Last check: {health.timestamp}
          </p>
        )}
      </div>
    </main>
  );
}
