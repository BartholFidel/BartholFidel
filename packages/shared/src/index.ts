/**
 * Shared types for BartholFidel platform services.
 */

/** Health check response from GET /api/health */
export interface HealthCheckResponse {
  success: boolean;
  platform: "BartholFidel";
  status: "online";
  timestamp: string;
}

export type EntitySource = "web2" | "web3";

/** Monitored entity record */
export interface Entity {
  id: string;
  name: string;
  type: string;
  source: EntitySource;
  chain_id: number | null;
  address: string | null;
  config: Record<string, unknown>;
  risk_tier: string;
  historically_compromised: boolean;
  last_active_at: string | null;
  created_at: string;
  updated_at: string;
}

/** GitHub repository entity configuration */
export interface GitHubRepoConfig {
  owner: string;
  repo: string;
  watch_actions: boolean;
  github_last_collaborator_count?: number;
  github_last_workflow_count?: number;
  github_workflow_domains?: Record<string, string[]>;
  github_last_workflow_modified?: number;
}

/** EOA wallet entity configuration */
export interface EoaWalletConfig {
  address: string;
  chain_id: number;
}

export interface SmartContractConfig {
  address: string;
  chain_id: number;
}

export interface TokenConfig {
  address: string;
  chain_id: number;
  symbol?: string;
  chainlink_feed_address?: string;
}

export interface LiquidityPoolConfig {
  address: string;
  chain_id: number;
  protocol?: string;
}

/** POST /api/entities request body */
export interface CreateEntityBody {
  name: string;
  type: string;
  source: EntitySource;
  chain_id?: number;
  address?: string;
  config?:
    | Record<string, unknown>
    | GitHubRepoConfig
    | EoaWalletConfig
    | SmartContractConfig
    | TokenConfig
    | LiquidityPoolConfig;
}

/** PATCH /api/entities/:id request body */
export interface UpdateEntityBody {
  name?: string;
  chain_id?: number;
  address?: string | null;
  config?: Record<string, unknown>;
}

/** Single metric observation */
export interface EntityMetric {
  id: string;
  entity_id: string;
  metric: string;
  value: number;
  timestamp: string;
}

/** GET /api/entities/:id — metrics grouped by name (up to 10 each) */
export interface EntityDetailResponse {
  entity: Entity;
  metrics: Record<string, EntityMetric[]>;
}

export type BaselineStatus = "active" | "insufficient_data";

/** Statistical baseline for a metric window */
export interface EntityBaseline {
  id: string;
  entity_id: string;
  metric: string;
  window_days: number;
  mean: number | null;
  std_dev: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  sample_count: number;
  weight_adjustment: number;
  status: BaselineStatus;
  computed_at: string;
}

export type IncidentTier = "info" | "warning" | "critical";

export type IncidentStatus =
  | "open"
  | "confirmed"
  | "false_positive"
  | "resolved";

/** Metric that contributed to an incident */
export interface TriggeredMetric {
  metric: string;
  z_score: number;
  observed_value: number;
  baseline_mean: number | null;
  baseline_std_dev: number | null;
  severity: "suspicious" | "high" | "critical";
  timestamp: string;
}

/** Raw event summary attached to incident detail */
export interface RawPayloadSummary {
  event_type: string;
  source: string;
  ingest_timestamp: string;
  payload_preview: string;
}

/** Incident record */
export interface Incident {
  id: string;
  entity_id: string;
  entity_name?: string;
  composite_score: number;
  tier: IncidentTier;
  status: IncidentStatus;
  triggered_metrics: TriggeredMetric[];
  corroborating_signals: unknown[];
  surface: string;
  attack_pattern: string | null;
  created_at: string;
  resolved_at: string | null;
  raw_payload_summary?: RawPayloadSummary | null;
}

/** Active incident counts by tier for dashboard */
export interface IncidentTierCounts {
  info: number;
  warning: number;
  critical: number;
}

/** PATCH /api/incidents/:id/status */
export type IncidentStatusAction = "confirm" | "false_positive";

/** Semantic relationship types between entities */
export type RelationshipType =
  | "DEPENDS_ON" // npm_package -> npm_package (dependent -> dependency)
  | "DEPLOYED" // eoa_wallet -> smart_contract (deployer -> contract)
  | "CROSS_SURFACE" // manual cross-surface link
  | "RELATED"; // generic manual link

/** Relationship edge record (Postgres entity_relationships) */
export interface EntityRelationship {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: RelationshipType | string;
  confidence: number;
  last_confirmed_at: string;
}

/** Node in the entity relationship graph */
export interface GraphNode {
  id: string;
  name: string;
  type: string;
  source: EntitySource;
  risk_tier: string;
  historically_compromised: boolean;
}

/** Edge in the entity relationship graph */
export interface GraphEdge {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: RelationshipType | string;
  confidence: number;
}

/** GET /api/graph — full graph for rendering */
export interface EntityGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** GET /api/graph/path — shortest path between two entities */
export interface ShortestPathResponse {
  from: string;
  to: string;
  found: boolean;
  path: Entity[]; // ordered from -> to; [] when not found
}

/** POST /api/graph/relationships request body */
export interface CreateRelationshipBody {
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: RelationshipType | string;
  confidence?: number;
}

/** Standard API success wrapper */
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

/** Standard API error wrapper */
export interface ApiErrorResponse {
  success: false;
  error: string;
}
