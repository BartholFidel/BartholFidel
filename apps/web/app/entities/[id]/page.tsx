import type { EntityMetric } from "@bartholfidel/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchEntityDetail } from "@/lib/api";

const METRIC_LABELS: Record<string, { label: string; format: "int" | "usd" }> = {
  tx_count_per_day: { label: "Transactions / day", format: "int" },
  volume_usd_per_day: { label: "Volume / day", format: "usd" },
  unique_counterparties_per_day: {
    label: "Unique counterparties / day",
    format: "int",
  },
  contracts_interacted_per_day: {
    label: "Contracts interacted / day",
    format: "int",
  },
};

function formatValue(value: number, format: "int" | "usd"): string {
  if (format === "usd") {
    return value.toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function metricMeta(metric: string): { label: string; format: "int" | "usd" } {
  return METRIC_LABELS[metric] ?? { label: metric, format: "int" };
}

function MetricCard({
  metric,
  observations,
}: {
  metric: string;
  observations: EntityMetric[];
}): JSX.Element {
  const { label, format } = metricMeta(metric);
  const latest = observations[0];
  return (
    <div className="rounded-xl border border-surface-border bg-surface-raised p-5">
      <p className="font-mono text-xs uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <p className="mt-1 text-3xl font-semibold text-white">
        {latest ? formatValue(latest.value, format) : "—"}
      </p>
      {latest && (
        <p className="mt-1 text-xs text-gray-500">
          latest: {formatDate(latest.timestamp)}
        </p>
      )}
      {observations.length > 1 && (
        <ul className="mt-3 space-y-1 border-t border-surface-border/60 pt-3">
          {observations.slice(0, 10).map((obs) => (
            <li
              key={obs.id}
              className="flex justify-between font-mono text-xs text-gray-400"
            >
              <span>{new Date(obs.timestamp).toISOString().split("T")[0]}</span>
              <span className="text-gray-300">
                {formatValue(obs.value, format)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default async function EntityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;

  let detail;
  try {
    detail = await fetchEntityDetail(id);
  } catch {
    notFound();
  }

  const { entity, metrics } = detail;
  const metricNames = Object.keys(metrics);

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8">
          <Link
            href="/entities"
            className="mb-2 inline-block font-mono text-xs uppercase tracking-widest text-accent hover:text-accent-muted"
          >
            ← Entities
          </Link>
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">
            {entity.source} · {entity.type}
          </p>
          <h1 className="text-3xl font-semibold text-white">{entity.name}</h1>
          {entity.address && (
            <p className="mt-1 break-all font-mono text-sm text-gray-400">
              {entity.address}
            </p>
          )}
        </header>

        <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-surface-border bg-surface/50 px-4 py-3">
            <p className="font-mono text-xs uppercase text-gray-500">Risk tier</p>
            <p className="mt-1 text-lg font-medium capitalize text-white">
              {entity.risk_tier}
            </p>
          </div>
          <div className="rounded-lg border border-surface-border bg-surface/50 px-4 py-3">
            <p className="font-mono text-xs uppercase text-gray-500">Chain</p>
            <p className="mt-1 text-lg font-medium text-white">
              {entity.chain_id ?? "—"}
            </p>
          </div>
          <div className="rounded-lg border border-surface-border bg-surface/50 px-4 py-3">
            <p className="font-mono text-xs uppercase text-gray-500">Last active</p>
            <p className="mt-1 text-sm font-medium text-white">
              {entity.last_active_at ? formatDate(entity.last_active_at) : "—"}
            </p>
          </div>
          <div className="rounded-lg border border-surface-border bg-surface/50 px-4 py-3">
            <p className="font-mono text-xs uppercase text-gray-500">Added</p>
            <p className="mt-1 text-sm font-medium text-white">
              {formatDate(entity.created_at)}
            </p>
          </div>
        </section>

        <h2 className="mb-4 text-lg font-medium text-white">
          Transaction Metrics
        </h2>
        {metricNames.length === 0 ? (
          <p className="rounded-xl border border-surface-border bg-surface-raised p-8 text-center text-gray-400">
            No transaction metrics recorded yet. Metrics appear once the wallet
            transacts while the stream is running, or after running the backfill
            script.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {metricNames.map((metric) => (
              <MetricCard
                key={metric}
                metric={metric}
                observations={metrics[metric] ?? []}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
