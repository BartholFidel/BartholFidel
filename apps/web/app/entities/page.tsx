"use client";

import type { CreateEntityBody, Entity, EntitySource } from "@bartholfidel/shared";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  createEntity,
  deleteEntity,
  fetchEntities,
} from "@/lib/api";

const ENTITY_TYPES = [
  { value: "npm_package", label: "npm Package" },
  { value: "smart_contract", label: "Smart Contract" },
  { value: "wallet", label: "Wallet" },
  { value: "domain", label: "Domain" },
  { value: "other", label: "Other" },
] as const;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function riskTierClass(tier: string): string {
  switch (tier) {
    case "critical":
      return "text-red-400 bg-red-400/10 border-red-400/30";
    case "warning":
      return "text-amber-400 bg-amber-400/10 border-amber-400/30";
    case "high":
      return "text-orange-400 bg-orange-400/10 border-orange-400/30";
    default:
      return "text-emerald-400 bg-emerald-400/10 border-emerald-400/30";
  }
}

export default function EntitiesPage(): JSX.Element {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [type, setType] = useState<string>("npm_package");
  const [source, setSource] = useState<EntitySource>("web2");

  const loadEntities = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchEntities();
      setEntities(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load entities");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEntities();
  }, [loadEntities]);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!name.trim()) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const body: CreateEntityBody = {
        name: name.trim(),
        type,
        source,
        config: {},
      };
      await createEntity(body);
      setName("");
      setType("npm_package");
      setSource("web2");
      setShowForm(false);
      await loadEntities();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add entity");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string): Promise<void> {
    if (!window.confirm("Remove this entity from the watchlist?")) {
      return;
    }
    try {
      await deleteEntity(id);
      await loadEntities();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete entity");
    }
  }

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link
              href="/dashboard"
              className="mb-2 inline-block font-mono text-xs uppercase tracking-widest text-accent hover:text-accent-muted"
            >
              ← Dashboard
            </Link>
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">
              Entity Watchlist
            </p>
            <h1 className="text-3xl font-semibold text-white">BartholFidel</h1>
            <p className="mt-1 text-sm text-gray-400">
              Monitored entities across web2 and web3 surfaces
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm((open) => !open)}
            className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-surface transition hover:bg-accent-muted"
          >
            {showForm ? "Cancel" : "Add Entity"}
          </button>
        </header>

        {showForm && (
          <form
            onSubmit={(e) => void handleSubmit(e)}
            className="mb-8 rounded-xl border border-surface-border bg-surface-raised p-6"
          >
            <h2 className="mb-4 text-lg font-medium text-white">Add Entity</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">
                  Name
                </span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. lodash"
                  required
                  className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-white placeholder:text-gray-600 focus:border-accent focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">
                  Type
                </span>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-white focus:border-accent focus:outline-none"
                >
                  {ENTITY_TYPES.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">
                  Source
                </span>
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value as EntitySource)}
                  className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-white focus:border-accent focus:outline-none"
                >
                  <option value="web2">web2</option>
                  <option value="web3">web3</option>
                </select>
              </label>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="mt-4 rounded-lg bg-accent px-5 py-2 text-sm font-medium text-surface hover:bg-accent-muted disabled:opacity-50"
            >
              {submitting ? "Adding…" : "Add to Watchlist"}
            </button>
          </form>
        )}

        {error && (
          <p className="mb-4 rounded-lg border border-status-offline/30 bg-status-offline/10 px-4 py-3 text-sm text-status-offline">
            {error}
          </p>
        )}

        <div className="overflow-hidden rounded-xl border border-surface-border bg-surface-raised">
          {loading ? (
            <p className="p-8 text-center text-gray-400">Loading entities…</p>
          ) : entities.length === 0 ? (
            <p className="p-8 text-center text-gray-400">
              No entities monitored yet. Add your first entity above.
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-surface-border bg-surface/50 font-mono text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Risk Tier</th>
                  <th className="px-4 py-3">Created At</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entities.map((entity) => (
                  <tr
                    key={entity.id}
                    className="border-b border-surface-border/60 hover:bg-surface/40"
                  >
                    <td className="px-4 py-3 font-medium text-white">
                      {entity.name}
                    </td>
                    <td className="px-4 py-3 text-gray-300">{entity.type}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-400">
                      {entity.source}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded border px-2 py-0.5 text-xs font-medium capitalize ${riskTierClass(entity.risk_tier)}`}
                      >
                        {entity.risk_tier}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {formatDate(entity.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => void handleDelete(entity.id)}
                        className="text-xs text-gray-500 hover:text-status-offline"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  );
}
