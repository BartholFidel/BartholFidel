"use client";

import type { Incident, RawPayloadSummary } from "@bartholfidel/shared";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useState } from "react";
import {
  fetchIncidentPayload,
  fetchIncidents,
  updateIncidentStatus,
} from "@/lib/api";

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function tierRowClass(tier: string): string {
  switch (tier) {
    case "critical":
      return "border-l-4 border-l-red-500";
    case "warning":
      return "border-l-4 border-l-amber-500";
    default:
      return "border-l-4 border-l-blue-500";
  }
}

function tierBadgeClass(tier: string): string {
  switch (tier) {
    case "critical":
      return "text-red-400 bg-red-400/10 border-red-400/30";
    case "warning":
      return "text-amber-400 bg-amber-400/10 border-amber-400/30";
    default:
      return "text-blue-400 bg-blue-400/10 border-blue-400/30";
  }
}

export default function IncidentsPage(): JSX.Element {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [payloads, setPayloads] = useState<Record<string, RawPayloadSummary | null>>({});
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadIncidents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchIncidents();
      setIncidents(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load incidents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadIncidents();
  }, [loadIncidents]);

  async function toggleExpand(incident: Incident): Promise<void> {
    if (expandedId === incident.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(incident.id);
    if (!(incident.id in payloads)) {
      try {
        const summary = await fetchIncidentPayload(incident.id);
        setPayloads((prev) => ({ ...prev, [incident.id]: summary }));
      } catch {
        setPayloads((prev) => ({ ...prev, [incident.id]: null }));
      }
    }
  }

  async function handleStatus(
    incidentId: string,
    action: "confirm" | "false_positive",
  ): Promise<void> {
    setUpdatingId(incidentId);
    try {
      await updateIncidentStatus(incidentId, action);
      await loadIncidents();
      setExpandedId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update incident");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-10">
          <Link
            href="/dashboard"
            className="mb-2 inline-block font-mono text-xs uppercase tracking-widest text-accent hover:text-accent-muted"
          >
            ← Dashboard
          </Link>
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">
            Threat Incidents
          </p>
          <h1 className="text-3xl font-semibold text-white">BartholFidel</h1>
          <p className="mt-1 text-sm text-gray-400">
            Correlated anomalies escalated from baseline scoring
          </p>
        </header>

        {error && (
          <p className="mb-4 rounded-lg border border-status-offline/30 bg-status-offline/10 px-4 py-3 text-sm text-status-offline">
            {error}
          </p>
        )}

        <div className="overflow-hidden rounded-xl border border-surface-border bg-surface-raised">
          {loading ? (
            <p className="p-8 text-center text-gray-400">Loading incidents…</p>
          ) : incidents.length === 0 ? (
            <p className="p-8 text-center text-gray-400">
              No incidents detected. BartholFidel is watching.
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-surface-border bg-surface/50 font-mono text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">Entity</th>
                  <th className="px-4 py-3">Surface</th>
                  <th className="px-4 py-3">Tier</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">Attack Pattern</th>
                  <th className="px-4 py-3">Age</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((incident) => (
                  <Fragment key={incident.id}>
                    <tr
                      onClick={() => void toggleExpand(incident)}
                      className={`cursor-pointer border-b border-surface-border/60 hover:bg-surface/40 ${tierRowClass(incident.tier)}`}
                    >
                      <td className="px-4 py-3 font-medium text-white">
                        {incident.entity_name ?? incident.entity_id.slice(0, 8)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-400">
                        {incident.surface}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded border px-2 py-0.5 text-xs font-medium uppercase ${tierBadgeClass(incident.tier)}`}
                        >
                          {incident.tier}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-gray-200">
                        {incident.composite_score.toFixed(3)}
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        {incident.attack_pattern ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        {formatAge(incident.created_at)}
                      </td>
                      <td className="px-4 py-3 capitalize text-gray-300">
                        {incident.status.replace("_", " ")}
                      </td>
                    </tr>
                    {expandedId === incident.id && (
                      <tr key={`${incident.id}-detail`} className="bg-surface/30">
                        <td colSpan={7} className="px-6 py-5">
                          <div className="grid gap-6 lg:grid-cols-2">
                            <div>
                              <h3 className="mb-2 font-mono text-xs uppercase text-gray-500">
                                Triggered Metrics
                              </h3>
                              <ul className="space-y-2">
                                {incident.triggered_metrics.map((m) => (
                                  <li
                                    key={`${m.metric}-${m.timestamp}`}
                                    className="rounded border border-surface-border bg-surface px-3 py-2 font-mono text-xs"
                                  >
                                    <span className="text-accent">{m.metric}</span>
                                    <span className="text-gray-500"> · z=</span>
                                    <span className="text-white">{m.z_score}</span>
                                    <span className="text-gray-500">
                                      {" "}
                                      · observed={m.observed_value}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <div>
                              <h3 className="mb-2 font-mono text-xs uppercase text-gray-500">
                                Raw Payload Summary
                              </h3>
                              <pre className="max-h-40 overflow-auto rounded border border-surface-border bg-surface p-3 font-mono text-xs text-gray-400">
                                {payloads[incident.id]
                                  ? JSON.stringify(payloads[incident.id], null, 2)
                                  : "Loading…"}
                              </pre>
                            </div>
                          </div>
                          <div className="mt-4 flex gap-3">
                            <button
                              type="button"
                              disabled={updatingId === incident.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleStatus(incident.id, "confirm");
                              }}
                              className="rounded-lg border border-status-online/40 bg-status-online/10 px-4 py-2 text-sm text-status-online hover:bg-status-online/20 disabled:opacity-50"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              disabled={updatingId === incident.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleStatus(incident.id, "false_positive");
                              }}
                              className="rounded-lg border border-gray-600 bg-surface px-4 py-2 text-sm text-gray-300 hover:bg-surface-border disabled:opacity-50"
                            >
                              False Positive
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  );
}
