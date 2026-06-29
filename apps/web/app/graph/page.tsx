"use client";

import type {
  EntityGraph,
  GraphEdge,
  GraphNode,
  RelationshipType,
  ShortestPathResponse,
} from "@bartholfidel/shared";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createRelationship,
  deleteRelationship,
  fetchGraph,
  fetchShortestPath,
} from "@/lib/api";

// Cytoscape touches the DOM on import, so the canvas must never be server-rendered.
const GraphCanvas = dynamic(() => import("./GraphCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-gray-500">
      Loading graph…
    </div>
  ),
});

const RELATIONSHIP_TYPES: { value: RelationshipType; label: string }[] = [
  { value: "CROSS_SURFACE", label: "Cross-surface link" },
  { value: "RELATED", label: "Related" },
  { value: "DEPENDS_ON", label: "Depends on" },
  { value: "DEPLOYED", label: "Deployed" },
];

/** Maps the ordered path node ids to the edge ids that connect them. */
function edgeIdsAlongPath(pathIds: string[], edges: GraphEdge[]): string[] {
  const ids: string[] = [];
  for (let i = 0; i < pathIds.length - 1; i += 1) {
    const a = pathIds[i];
    const b = pathIds[i + 1];
    if (!a || !b) {
      continue;
    }
    const edge = edges.find(
      (e) =>
        (e.source_entity_id === a && e.target_entity_id === b) ||
        (e.source_entity_id === b && e.target_entity_id === a),
    );
    if (edge) {
      ids.push(edge.id);
    }
  }
  return ids;
}

export default function GraphPage(): JSX.Element {
  const [graph, setGraph] = useState<EntityGraph>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search-to-center
  const [search, setSearch] = useState("");
  const [centerNodeId, setCenterNodeId] = useState<string | null>(null);

  // Shortest path
  const [pathFrom, setPathFrom] = useState("");
  const [pathTo, setPathTo] = useState("");
  const [pathResult, setPathResult] = useState<ShortestPathResponse | null>(null);
  const [pathLoading, setPathLoading] = useState(false);

  // Manual relationship
  const [relSource, setRelSource] = useState("");
  const [relTarget, setRelTarget] = useState("");
  const [relType, setRelType] = useState<RelationshipType>("CROSS_SURFACE");
  const [linking, setLinking] = useState(false);

  // Edge selection (for deletion)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const loadGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchGraph();
      setGraph(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load graph");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGraph();
  }, [loadGraph]);

  const nodesByName = useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const node of graph.nodes) {
      map.set(node.name.toLowerCase(), node);
    }
    return map;
  }, [graph.nodes]);

  const nodesById = useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const node of graph.nodes) {
      map.set(node.id, node);
    }
    return map;
  }, [graph.nodes]);

  const sortedNodes = useMemo(
    () => [...graph.nodes].sort((a, b) => a.name.localeCompare(b.name)),
    [graph.nodes],
  );

  const highlightedNodeIds = useMemo(
    () => (pathResult?.found ? pathResult.path.map((e) => e.id) : []),
    [pathResult],
  );

  const highlightedEdgeIds = useMemo(
    () =>
      pathResult?.found
        ? edgeIdsAlongPath(
            pathResult.path.map((e) => e.id),
            graph.edges,
          )
        : [],
    [pathResult, graph.edges],
  );

  const selectedEdge = useMemo(
    () =>
      selectedEdgeId
        ? graph.edges.find((e) => e.id === selectedEdgeId) ?? null
        : null,
    [selectedEdgeId, graph.edges],
  );

  function handleSearch(event: React.FormEvent): void {
    event.preventDefault();
    const term = search.trim().toLowerCase();
    if (!term) {
      return;
    }
    const exact = nodesByName.get(term);
    const node =
      exact ??
      graph.nodes.find((n) => n.name.toLowerCase().includes(term)) ??
      null;
    if (!node) {
      setError(`No entity matching "${search.trim()}"`);
      return;
    }
    setError(null);
    // Force the centering effect to re-run even when the same node is searched.
    setCenterNodeId(null);
    window.requestAnimationFrame(() => setCenterNodeId(node.id));
  }

  async function handleFindPath(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!pathFrom || !pathTo || pathFrom === pathTo) {
      return;
    }
    setPathLoading(true);
    setError(null);
    try {
      const result = await fetchShortestPath(pathFrom, pathTo);
      setPathResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to compute path");
    } finally {
      setPathLoading(false);
    }
  }

  function clearPath(): void {
    setPathResult(null);
  }

  async function handleLink(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!relSource || !relTarget || relSource === relTarget) {
      return;
    }
    setLinking(true);
    setError(null);
    try {
      await createRelationship({
        source_entity_id: relSource,
        target_entity_id: relTarget,
        relationship_type: relType,
      });
      setRelSource("");
      setRelTarget("");
      await loadGraph();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create link");
    } finally {
      setLinking(false);
    }
  }

  async function handleDeleteEdge(): Promise<void> {
    if (!selectedEdgeId) {
      return;
    }
    if (!window.confirm("Delete this relationship?")) {
      return;
    }
    setError(null);
    try {
      await deleteRelationship(selectedEdgeId);
      setSelectedEdgeId(null);
      setPathResult(null);
      await loadGraph();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete link");
    }
  }

  const inputClass =
    "w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:border-accent focus:outline-none";
  const labelClass =
    "mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400";

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8">
          <Link
            href="/dashboard"
            className="mb-2 inline-block font-mono text-xs uppercase tracking-widest text-accent hover:text-accent-muted"
          >
            ← Dashboard
          </Link>
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">
            Relationship Graph
          </p>
          <h1 className="text-3xl font-semibold text-white">BartholFidel</h1>
          <p className="mt-1 text-sm text-gray-400">
            {graph.nodes.length} entities · {graph.edges.length} relationships
            across web2 and web3 surfaces
          </p>
        </header>

        {error && (
          <p className="mb-4 rounded-lg border border-status-offline/30 bg-status-offline/10 px-4 py-3 text-sm text-status-offline">
            {error}
          </p>
        )}

        <div className="mb-6 grid gap-4 lg:grid-cols-3">
          {/* Search → center */}
          <form
            onSubmit={handleSearch}
            className="rounded-xl border border-surface-border bg-surface-raised p-4"
          >
            <span className={labelClass}>Find &amp; center</span>
            <div className="flex gap-2">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Entity name…"
                list="graph-entity-names"
                className={inputClass}
              />
              <button
                type="submit"
                className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface transition hover:bg-accent-muted"
              >
                Center
              </button>
            </div>
            <datalist id="graph-entity-names">
              {sortedNodes.map((n) => (
                <option key={n.id} value={n.name} />
              ))}
            </datalist>
          </form>

          {/* Shortest path */}
          <form
            onSubmit={(e) => void handleFindPath(e)}
            className="rounded-xl border border-surface-border bg-surface-raised p-4"
          >
            <span className={labelClass}>Shortest path</span>
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <select
                  value={pathFrom}
                  onChange={(e) => setPathFrom(e.target.value)}
                  className={inputClass}
                >
                  <option value="">From…</option>
                  {sortedNodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
                <select
                  value={pathTo}
                  onChange={(e) => setPathTo(e.target.value)}
                  className={inputClass}
                >
                  <option value="">To…</option>
                  {sortedNodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={
                    pathLoading ||
                    !pathFrom ||
                    !pathTo ||
                    pathFrom === pathTo
                  }
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface transition hover:bg-accent-muted disabled:opacity-50"
                >
                  {pathLoading ? "Finding…" : "Find path"}
                </button>
                {pathResult && (
                  <button
                    type="button"
                    onClick={clearPath}
                    className="rounded-lg border border-surface-border px-4 py-2 text-sm text-gray-300 transition hover:border-accent hover:text-accent"
                  >
                    Clear
                  </button>
                )}
                {pathResult && (
                  <span className="text-xs text-gray-400">
                    {pathResult.found
                      ? `${pathResult.path.length - 1} hop(s)`
                      : "No path"}
                  </span>
                )}
              </div>
            </div>
          </form>

          {/* Manual relationship */}
          <form
            onSubmit={(e) => void handleLink(e)}
            className="rounded-xl border border-surface-border bg-surface-raised p-4"
          >
            <span className={labelClass}>Link entities</span>
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <select
                  value={relSource}
                  onChange={(e) => setRelSource(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Source…</option>
                  {sortedNodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
                <select
                  value={relTarget}
                  onChange={(e) => setRelTarget(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Target…</option>
                  {sortedNodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <select
                  value={relType}
                  onChange={(e) =>
                    setRelType(e.target.value as RelationshipType)
                  }
                  className={inputClass}
                >
                  {RELATIONSHIP_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={
                    linking ||
                    !relSource ||
                    !relTarget ||
                    relSource === relTarget
                  }
                  className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface transition hover:bg-accent-muted disabled:opacity-50"
                >
                  {linking ? "Linking…" : "Link"}
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* Selected edge actions */}
        {selectedEdge && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent/5 px-4 py-3">
            <p className="text-sm text-gray-200">
              <span className="font-medium text-white">
                {nodesById.get(selectedEdge.source_entity_id)?.name ?? "?"}
              </span>{" "}
              <span className="font-mono text-xs text-accent">
                {selectedEdge.relationship_type}
              </span>{" "}
              →{" "}
              <span className="font-medium text-white">
                {nodesById.get(selectedEdge.target_entity_id)?.name ?? "?"}
              </span>
            </p>
            <button
              type="button"
              onClick={() => void handleDeleteEdge()}
              className="rounded-lg border border-status-offline/40 px-4 py-1.5 text-sm text-status-offline transition hover:bg-status-offline/10"
            >
              Delete relationship
            </button>
          </div>
        )}

        {/* Canvas */}
        <div className="relative h-[600px] overflow-hidden rounded-xl border border-surface-border bg-surface-raised">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-400">
              Loading graph…
            </div>
          ) : graph.nodes.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-gray-400">
              <p>No entities to graph yet.</p>
              <Link href="/entities" className="text-sm text-accent hover:underline">
                Add entities to get started →
              </Link>
            </div>
          ) : (
            <GraphCanvas
              nodes={graph.nodes}
              edges={graph.edges}
              centerNodeId={centerNodeId}
              highlightedNodeIds={highlightedNodeIds}
              highlightedEdgeIds={highlightedEdgeIds}
              onEdgeSelect={setSelectedEdgeId}
            />
          )}
        </div>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap items-center gap-5 text-xs text-gray-400">
          <span className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-accent" /> web2 entity
          </span>
          <span className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-[#a855f7]" /> web3 entity
          </span>
          <span className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full border-2 border-status-offline" />{" "}
            high risk / compromised
          </span>
          <span className="flex items-center gap-2">
            <span className="h-0.5 w-5 bg-status-online" /> shortest path
          </span>
          <span className="text-gray-500">Tap an edge to delete it.</span>
        </div>
      </div>
    </main>
  );
}
