import type { Entity } from "@bartholfidel/shared";
import {
  createEntity,
  findEntityByName,
  findWeb3EntityByAddress,
  listEntities,
} from "../repositories/entities.repository.js";
import {
  createRelationship,
  syncEntityNode,
} from "../repositories/relationships.repository.js";
import { fetchDirectDependencies } from "../ingestion/web2/npm.collector.js";
import { resolveContractDeployer } from "../ingestion/web3/deployer.js";

// Guardrail: only link DIRECT dependencies and cap the fan-out so adding a
// package with a huge dependency tree cannot flood the graph.
const MAX_DIRECT_DEPENDENCIES = 60;

/**
 * Derives relationship edges for a newly added entity. Each branch is isolated
 * so a failure never blocks entity creation.
 */
export async function inferRelationshipsForEntity(entity: Entity): Promise<void> {
  if (entity.source === "web2" && entity.type === "npm_package") {
    await inferNpmDependencies(entity).catch((error: unknown) => {
      console.error("[inference] npm dependency inference failed:", error);
    });
    return;
  }
  if (entity.source === "web3" && entity.type === "smart_contract") {
    await inferDeploymentForContract(entity).catch((error: unknown) => {
      console.error("[inference] contract deployment inference failed:", error);
    });
    return;
  }
  if (entity.source === "web3" && entity.type === "eoa_wallet") {
    await inferDeploymentsForWallet(entity).catch((error: unknown) => {
      console.error("[inference] wallet deployment inference failed:", error);
    });
  }
}

/**
 * Links an npm package to its direct dependencies via DEPENDS_ON edges,
 * auto-creating lightweight package entities for dependencies not yet watched.
 */
async function inferNpmDependencies(entity: Entity): Promise<void> {
  const deps = (await fetchDirectDependencies(entity.name)).slice(
    0,
    MAX_DIRECT_DEPENDENCIES,
  );
  if (deps.length === 0) {
    return;
  }

  await syncEntityNode(entity);
  let created = 0;
  for (const depName of deps) {
    if (depName === entity.name) {
      continue;
    }
    const depEntity = await ensureNpmPackageEntity(depName);
    await createRelationship({
      sourceEntityId: entity.id,
      targetEntityId: depEntity.id,
      relationshipType: "DEPENDS_ON",
    });
    created += 1;
  }
  console.log(
    `[inference] ${entity.name}: ${created} DEPENDS_ON edge(s)`,
  );
}

/** Returns the watched npm package entity, creating a lightweight one if absent. */
async function ensureNpmPackageEntity(name: string): Promise<Entity> {
  const existing = await findEntityByName(name, "npm_package", "web2");
  if (existing) {
    return existing;
  }
  const entity = await createEntity({
    name,
    type: "npm_package",
    source: "web2",
    config: { auto_created: true },
  });
  await syncEntityNode(entity);
  return entity;
}

/** Resolves the contract's deployer and links a watched wallet via DEPLOYED. */
async function inferDeploymentForContract(entity: Entity): Promise<void> {
  if (!entity.address) {
    return;
  }
  const deployer = await resolveContractDeployer(
    entity.address,
    entity.chain_id ?? 1,
  );
  if (!deployer) {
    return;
  }
  const wallet = await findWeb3EntityByAddress(deployer, ["eoa_wallet"]);
  if (!wallet) {
    return;
  }
  await syncEntityNode(wallet);
  await syncEntityNode(entity);
  await createRelationship({
    sourceEntityId: wallet.id,
    targetEntityId: entity.id,
    relationshipType: "DEPLOYED",
  });
  console.log(
    `[inference] DEPLOYED edge: ${wallet.name} -> ${entity.name}`,
  );
}

/**
 * When a wallet is added after the contracts it deployed, backfill DEPLOYED
 * edges by checking each watched contract's deployer against this wallet.
 */
async function inferDeploymentsForWallet(entity: Entity): Promise<void> {
  if (!entity.address) {
    return;
  }
  const walletAddress = entity.address.toLowerCase();
  const contracts = await listEntities({
    source: "web3",
    type: "smart_contract",
  });

  for (const contract of contracts) {
    if (!contract.address) {
      continue;
    }
    const deployer = await resolveContractDeployer(
      contract.address,
      contract.chain_id ?? 1,
    );
    if (deployer && deployer.toLowerCase() === walletAddress) {
      await syncEntityNode(entity);
      await syncEntityNode(contract);
      await createRelationship({
        sourceEntityId: entity.id,
        targetEntityId: contract.id,
        relationshipType: "DEPLOYED",
      });
      console.log(
        `[inference] DEPLOYED edge: ${entity.name} -> ${contract.name}`,
      );
    }
  }
}
