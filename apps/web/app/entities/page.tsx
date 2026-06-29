"use client";

import type {
  CreateEntityBody,
  Entity,
  EntitySource,
  UpdateEntityBody,
} from "@bartholfidel/shared";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  createEntity,
  deleteEntity,
  fetchEntities,
  updateEntity,
} from "@/lib/api";

const ENTITY_TYPES_WEB2 = [
  { value: "npm_package", label: "npm Package" },
  { value: "github_repo", label: "GitHub Repository" },
  { value: "smart_contract", label: "Smart Contract" },
  { value: "domain", label: "Domain" },
  { value: "other", label: "Other" },
] as const;

const ENTITY_TYPES_WEB3 = [
  { value: "eoa_wallet", label: "EOA Wallet" },
  { value: "smart_contract", label: "Smart Contract" },
  { value: "token", label: "Token" },
  { value: "liquidity_pool", label: "Liquidity Pool" },
  { value: "other", label: "Other" },
] as const;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function truncateAddress(addr: string | null): string {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
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
  const [activeTab, setActiveTab] = useState<EntitySource>("web2");

  const [name, setName] = useState("");
  const [type, setType] = useState<string>("npm_package");
  const [source, setSource] = useState<EntitySource>("web2");
  const [watchActions, setWatchActions] = useState(true);
  const [walletAddress, setWalletAddress] = useState("");
  const [chainId, setChainId] = useState<number>(1);
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [chainlinkFeedAddress, setChainlinkFeedAddress] = useState("");
  const [poolProtocol, setPoolProtocol] = useState("");
  const [editingEntity, setEditingEntity] = useState<Entity | null>(null);
  const [copiedAddressId, setCopiedAddressId] = useState<string | null>(null);

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

  function resetForm(): void {
    setEditingEntity(null);
    setName("");
    setType(source === "web2" ? "npm_package" : "eoa_wallet");
    setWatchActions(true);
    setWalletAddress("");
    setChainId(1);
    setTokenSymbol("");
    setChainlinkFeedAddress("");
    setPoolProtocol("");
  }

  function openEditForm(entity: Entity): void {
    setEditingEntity(entity);
    setShowForm(true);
    setName(entity.name);
    setSource(entity.source);
    setType(entity.type);
    setWalletAddress(entity.address ?? "");
    setChainId(entity.chain_id ?? 1);
    setWatchActions(
      entity.config?.watch_actions === false ? false : true,
    );
    setTokenSymbol(
      typeof entity.config?.symbol === "string" ? entity.config.symbol : "",
    );
    setChainlinkFeedAddress(
      typeof entity.config?.chainlink_feed_address === "string"
        ? entity.config.chainlink_feed_address
        : "",
    );
    setPoolProtocol(
      typeof entity.config?.protocol === "string" ? entity.config.protocol : "",
    );
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!name.trim()) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      let config: Record<string, unknown> = {};

      if (type === "github_repo") {
        const parts = name.trim().split("/");
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
          throw new Error('GitHub name must be "owner/repo" (e.g. facebook/react)');
        }
        config = {
          owner: parts[0],
          repo: parts[1],
          watch_actions: watchActions,
        };
      }

      if (type === "token") {
        config = {
          symbol: tokenSymbol.trim() || undefined,
          chainlink_feed_address: chainlinkFeedAddress.trim().toLowerCase() || undefined,
        };
      }

      if (type === "liquidity_pool") {
        config = {
          protocol: poolProtocol.trim() || undefined,
        };
      }

      if (editingEntity) {
        const updateBody: UpdateEntityBody = {
          name: name.trim(),
        };
        if (
          ["eoa_wallet", "smart_contract", "token", "liquidity_pool"].includes(type)
        ) {
          updateBody.address = walletAddress.trim().toLowerCase();
          updateBody.chain_id = chainId;
        }
        if (type === "token" || type === "liquidity_pool") {
          updateBody.config = config;
        }

        await updateEntity(editingEntity.id, updateBody);
      } else {
        const createBody: CreateEntityBody = {
          name: name.trim(),
          type,
          source,
          config,
          ...(["eoa_wallet", "smart_contract", "token", "liquidity_pool"].includes(type) && {
            address: walletAddress.trim().toLowerCase(),
            chain_id: chainId,
          }),
        };
        await createEntity(createBody);
      }

      resetForm();
      setShowForm(false);
      await loadEntities();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : editingEntity
          ? "Failed to update entity"
          : "Failed to add entity",
      );
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

  async function handleCopyAddress(address: string, entityId: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddressId(entityId);
      setTimeout(() => setCopiedAddressId(null), 2000);
    } catch (err) {
      console.error("Failed to copy address:", err);
    }
  }

  const isGitHub = type === "github_repo";
  const isEoaWallet = type === "eoa_wallet";
  const isWeb3Addressable =
    source === "web3" &&
    ["eoa_wallet", "smart_contract", "token", "liquidity_pool"].includes(type);
  const isToken = type === "token";
  const isLiquidityPool = type === "liquidity_pool";
  const entityTypes = source === "web2" ? ENTITY_TYPES_WEB2 : ENTITY_TYPES_WEB3;
  const filteredEntities = entities.filter((e) => e.source === activeTab);

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
            onClick={() => {
              if (showForm && editingEntity) {
                resetForm();
              }
              setShowForm((open) => !open);
            }}
            className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-surface transition hover:bg-accent-muted"
          >
            {showForm ? "Cancel" : editingEntity ? "Edit Entity" : "Add Entity"}
          </button>
        </header>

        {showForm && (
          <form
            onSubmit={(e) => void handleSubmit(e)}
            className="mb-8 rounded-xl border border-surface-border bg-surface-raised p-6"
          >
            <h2 className="mb-4 text-lg font-medium text-white">
              {editingEntity ? "Edit Entity" : "Add Entity"}
            </h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">
                  {isEoaWallet ? "Wallet Label" : "Name"}
                </span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={
                    isGitHub
                      ? "e.g. facebook/react"
                      : isEoaWallet
                        ? "e.g. Binance Hot Wallet"
                        : "e.g. lodash"
                  }
                  required
                  pattern={isGitHub ? "[^/]+/[^/]+" : undefined}
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
                  disabled={Boolean(editingEntity)}
                  className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-white focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {entityTypes.map((opt) => (
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
                  onChange={(e) => {
                    setSource(e.target.value as EntitySource);
                    setType(
                      e.target.value === "web2" ? "npm_package" : "eoa_wallet",
                    );
                  }}
                  disabled={Boolean(editingEntity)}
                  className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-white focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="web2">web2</option>
                  <option value="web3">web3</option>
                </select>
              </label>
              {isGitHub && (
                <label className="flex items-center gap-2 sm:col-span-3">
                  <input
                    type="checkbox"
                    checked={watchActions}
                    onChange={(e) => setWatchActions(e.target.checked)}
                    className="rounded border-surface-border"
                  />
                  <span className="text-sm text-gray-300">
                    Monitor GitHub Actions workflows
                  </span>
                </label>
              )}
              {isWeb3Addressable && (
                <>
                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">
                      Ethereum Address
                    </span>
                    <input
                      type="text"
                      value={walletAddress}
                      onChange={(e) =>
                        setWalletAddress(e.target.value.toLowerCase())
                      }
                      placeholder="0x..."
                      pattern="0x[a-fA-F0-9]{40}"
                      required
                      className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 font-mono text-white placeholder:text-gray-600 focus:border-accent focus:outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">
                      Chain ID
                    </span>
                    <select
                      value={chainId}
                      onChange={(e) => setChainId(Number(e.target.value))}
                      className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-white focus:border-accent focus:outline-none"
                    >
                      <option value={1}>Ethereum Mainnet (1)</option>
                    </select>
                  </label>
                </>
              )}
              {isToken && (
                <>
                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">
                      Token Symbol
                    </span>
                    <input
                      type="text"
                      value={tokenSymbol}
                      onChange={(e) => setTokenSymbol(e.target.value)}
                      placeholder="e.g. USDC"
                      className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-white placeholder:text-gray-600 focus:border-accent focus:outline-none"
                    />
                  </label>
                  <label className="block sm:col-span-3">
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">
                      Chainlink Feed Address
                    </span>
                    <input
                      type="text"
                      value={chainlinkFeedAddress}
                      onChange={(e) => setChainlinkFeedAddress(e.target.value.toLowerCase())}
                      placeholder="0x..."
                      className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 font-mono text-white placeholder:text-gray-600 focus:border-accent focus:outline-none"
                    />
                  </label>
                </>
              )}
              {isLiquidityPool && (
                <label className="block sm:col-span-3">
                  <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">
                    Protocol or Pool Label
                  </span>
                  <input
                    type="text"
                    value={poolProtocol}
                    onChange={(e) => setPoolProtocol(e.target.value)}
                    placeholder="e.g. Uniswap v3"
                    className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-white placeholder:text-gray-600 focus:border-accent focus:outline-none"
                  />
                </label>
              )}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-surface hover:bg-accent-muted disabled:opacity-50"
              >
                {submitting
                  ? editingEntity
                    ? "Saving…"
                    : "Adding…"
                  : editingEntity
                  ? "Save Changes"
                  : "Add to Watchlist"}
              </button>
              {editingEntity && (
                <button
                  type="button"
                  onClick={() => {
                    resetForm();
                    setShowForm(false);
                  }}
                  className="rounded-lg border border-surface-border bg-surface px-5 py-2 text-sm font-medium text-white hover:border-accent hover:text-accent"
                >
                  Cancel edit
                </button>
              )}
            </div>
          </form>
        )}

        {error && (
          <p className="mb-4 rounded-lg border border-status-offline/30 bg-status-offline/10 px-4 py-3 text-sm text-status-offline">
            {error}
          </p>
        )}

        {/* Tabs */}
        <div className="mb-6 flex gap-2 border-b border-surface-border">
          <button
            type="button"
            onClick={() => setActiveTab("web2")}
            className={`px-4 py-3 text-sm font-medium transition ${activeTab === "web2" ? "border-b-2 border-accent text-white" : "text-gray-400 hover:text-gray-300"}`}
          >
            Web2 Entities
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("web3")}
            className={`px-4 py-3 text-sm font-medium transition ${activeTab === "web3" ? "border-b-2 border-accent text-white" : "text-gray-400 hover:text-gray-300"}`}
          >
            Web3 Entities
          </button>
        </div>

        {/* Entities Table */}
        <div className="overflow-hidden rounded-xl border border-surface-border bg-surface-raised">
          {loading ? (
            <p className="p-8 text-center text-gray-400">Loading entities…</p>
          ) : filteredEntities.length === 0 ? (
            <p className="p-8 text-center text-gray-400">
              No {activeTab} entities monitored yet.
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-surface-border bg-surface/50 font-mono text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Type</th>
                  {activeTab === "web3" && (
                    <>
                      <th className="px-4 py-3">Address</th>
                      <th className="px-4 py-3">Last Active</th>
                    </>
                  )}
                  {activeTab === "web2" && (
                    <th className="px-4 py-3">Risk Tier</th>
                  )}
                  <th className="px-4 py-3">Created At</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntities.map((entity) => (
                  <tr
                    key={entity.id}
                    className="border-b border-surface-border/60 hover:bg-surface/40"
                  >
                    <td className="px-4 py-3 font-medium">
                      <Link
                        href={`/entities/${entity.id}`}
                        className="text-white hover:text-accent"
                      >
                        {entity.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-300">{entity.type}</td>
                    {activeTab === "web3" && (
                      <>
                        <td className="px-4 py-3 font-mono text-xs">
                          <button
                            type="button"
                            onClick={() => {
                              if (entity.address) {
                                void handleCopyAddress(entity.address, entity.id);
                              }
                            }}
                            title={entity.address || ""}
                            className={`rounded px-2 py-1 transition ${
                              copiedAddressId === entity.id
                                ? "bg-emerald-500/20 text-emerald-400"
                                : "text-gray-400 hover:text-accent hover:bg-accent/10 cursor-pointer"
                            }`}
                          >
                            {copiedAddressId === entity.id ? "✓ Copied" : truncateAddress(entity.address)}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-gray-400">
                          <span className="text-xs">
                            {entity.last_active_at
                              ? formatDate(entity.last_active_at)
                              : "—"}
                          </span>
                        </td>
                      </>
                    )}
                    {activeTab === "web2" && (
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded border px-2 py-0.5 text-xs font-medium capitalize ${riskTierClass(entity.risk_tier)}`}
                        >
                          {entity.risk_tier}
                        </span>
                      </td>
                    )}
                    <td className="px-4 py-3 text-gray-400">
                      {formatDate(entity.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      <button
                        type="button"
                        onClick={() => openEditForm(entity)}
                        className="text-xs text-gray-300 hover:text-white"
                      >
                        Edit
                      </button>
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
