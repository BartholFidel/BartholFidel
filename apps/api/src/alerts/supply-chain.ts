import type { IncidentTier, TriggeredMetric } from "@bartholfidel/shared";
import { getEntityById } from "../repositories/entities.repository.js";
import {
  createPatternIncident,
  hasRecentMetricSignal,
} from "../repositories/github.repository.js";

const TWENTY_FOUR_HOURS_MINUTES = 24 * 60;

/** SUPPLY_CHAIN_001: collaborator + workflow change within 24h → WARNING */
export async function evaluateSupplyChain001(entityId: string): Promise<void> {
  const [collaboratorAdded, workflowChanged] = await Promise.all([
    hasRecentMetricSignal(entityId, "new_collaborator_added", 1, TWENTY_FOUR_HOURS_MINUTES),
    hasRecentMetricSignal(entityId, "action_workflow_changed", 1, TWENTY_FOUR_HOURS_MINUTES),
  ]);

  if (!collaboratorAdded || !workflowChanged) {
    return;
  }

  const entity = await getEntityById(entityId);
  if (!entity) {
    return;
  }

  const triggeredMetrics: TriggeredMetric[] = [
    syntheticMetric("new_collaborator_added", 1),
    syntheticMetric("action_workflow_changed", 1),
  ];

  await createPatternIncident({
    entityId,
    tier: "warning",
    attackPattern: "SUPPLY_CHAIN_001",
    compositeScore: 0.7,
    triggeredMetrics,
    surface: `${entity.source}/${entity.type}`,
    corroboratingSignals: [
      { rule: "SUPPLY_CHAIN_001", description: "New collaborator and workflow change within 24h" },
    ],
  });

  console.log(`[supply-chain] SUPPLY_CHAIN_001 incident for entity=${entityId}`);
}

/** SUPPLY_CHAIN_002: workflow change + new external domain in same push → CRITICAL */
export async function evaluateSupplyChain002(params: {
  entityId: string;
  newDomains: string[];
  workflowPaths: string[];
}): Promise<void> {
  if (params.newDomains.length === 0 || params.workflowPaths.length === 0) {
    return;
  }

  const entity = await getEntityById(params.entityId);
  if (!entity) {
    return;
  }

  const triggeredMetrics: TriggeredMetric[] = [
    syntheticMetric("action_workflow_changed", 1),
  ];

  await createPatternIncident({
    entityId: params.entityId,
    tier: "critical",
    attackPattern: "SUPPLY_CHAIN_002",
    compositeScore: 0.95,
    triggeredMetrics,
    surface: `${entity.source}/${entity.type}`,
    corroboratingSignals: [
      {
        rule: "SUPPLY_CHAIN_002",
        new_external_domains: params.newDomains,
        workflow_paths: params.workflowPaths,
      },
    ],
  });

  console.log(
    `[supply-chain] SUPPLY_CHAIN_002 incident entity=${params.entityId} domains=${params.newDomains.join(",")}`,
  );
}

function syntheticMetric(metric: string, value: number): TriggeredMetric {
  return {
    metric,
    z_score: 0,
    observed_value: value,
    baseline_mean: null,
    baseline_std_dev: null,
    severity: "critical",
    timestamp: new Date().toISOString(),
  };
}
