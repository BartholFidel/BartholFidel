import type { Entity, TriggeredMetric } from "@bartholfidel/shared";
import { createPatternIncident } from "../repositories/github.repository.js";

function buildTriggeredMetric(
  metric: string,
  value: number,
  severity: "suspicious" | "high" | "critical",
): TriggeredMetric {
  return {
    metric,
    observed_value: value,
    baseline_mean: null,
    baseline_std_dev: null,
    z_score: severity === "critical" ? 4.0 : severity === "high" ? 3.0 : 2.0,
    severity,
    timestamp: new Date().toISOString(),
  };
}

export async function evaluateWeb3HighValuePendingTx(
  entity: Entity,
  txHash: string,
  valueUsd: number,
  from: string,
  to: string,
): Promise<void> {
  await createPatternIncident({
    entityId: entity.id,
    tier: valueUsd >= 200000 ? "critical" : "warning",
    attackPattern: "WEB3_001",
    compositeScore: valueUsd >= 200000 ? 90 : 70,
    surface: "web3",
    triggeredMetrics: [
      buildTriggeredMetric("pending_high_value_tx_usd", valueUsd, "high"),
    ],
    corroboratingSignals: [
      { type: "pending_tx", tx_hash: txHash, from, to, value_usd: valueUsd },
    ],
  });
}

export async function evaluateWeb3ContractEventAttack(
  entity: Entity,
  eventName: string,
  valueUsd: number,
  txHash: string,
  from: string | null,
  to: string | null,
): Promise<void> {
  if (eventName === "Transfer" && valueUsd >= 500000) {
    await createPatternIncident({
      entityId: entity.id,
      tier: "critical",
      attackPattern: "WEB3_002",
      compositeScore: 88,
      surface: "web3",
      triggeredMetrics: [
        buildTriggeredMetric("transfer_value_usd", valueUsd, "critical"),
      ],
      corroboratingSignals: [
        { event: eventName, tx_hash: txHash, from, to, value_usd: valueUsd },
      ],
    });
    return;
  }

  if (
    (eventName === "Swap" || eventName === "Sync" || eventName === "Burn") &&
    valueUsd >= 200000
  ) {
    await createPatternIncident({
      entityId: entity.id,
      tier: "warning",
      attackPattern: "WEB3_003",
      compositeScore: 75,
      surface: "web3",
      triggeredMetrics: [
        buildTriggeredMetric("defi_pool_event_usd", valueUsd, "high"),
      ],
      corroboratingSignals: [
        { event: eventName, tx_hash: txHash, value_usd: valueUsd },
      ],
    });
  }
}

export async function evaluateWeb3FlashLoanSignal(
  entity: Entity,
  txHash: string,
  method: string,
  valueUsd: number,
): Promise<void> {
  await createPatternIncident({
    entityId: entity.id,
    tier: "critical",
    attackPattern: "WEB3_006",
    compositeScore: 92,
    surface: "web3",
    triggeredMetrics: [
      buildTriggeredMetric("flashloan_borrow_signal_usd", valueUsd, "critical"),
    ],
    corroboratingSignals: [
      { type: "lending_signal", method, tx_hash: txHash, value_usd: valueUsd },
    ],
  });
}
