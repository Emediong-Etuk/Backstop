// One pass over all known vaults. Stateless: everything is re-read from the chain each time.
// The keeper holds no keys that matter and spends none of its own BCH: the miner fee and its
// reward come out of the vault reserve, within the vault's own overhead limit.
import type { NetworkProvider } from 'cashscript';
import {
  assemble, collateralRatioBps, liquidationPriceCents, paryonUnlockers, planRescue, priceAtRatio, readRescueState, rescueParts,
  type TransactionParts,
} from '@backstop/contracts';
import { deploymentContracts, findRescueUtxos, loadVault, utxoAgeBlocks, type Deployment, type Vault } from '@backstop/contracts';
import { describeRescue, formatBch, formatPercent, formatUsd } from './format.js';

export interface KeeperOptions {
  provider: NetworkProvider;
  deployment: Deployment;
  setupTxids: string[];
  /** Print the rescue instead of broadcasting it. */
  dryRun: boolean;
  /** Miner fee rate in sat/byte. */
  feeRate?: number;
  /** Reward the keeper asks for, capped by each vault's overhead limit. 0 for none. */
  keeperRewardSats?: bigint;
  /** Where the reward goes. Without it the keeper takes no reward. */
  keeperLockingBytecode?: string;
  log?: (line: string) => void;
}

export type VaultResult =
  | { setupTxid: string; action: 'skipped'; reason: string }
  | { setupTxid: string; action: 'waiting'; reason: string; ratioBps?: bigint }
  | { setupTxid: string; action: 'would-rescue' | 'rescued'; topUpSats: bigint; minerFeeSats: bigint; keeperRewardSats: bigint; txid?: string; hex: string };

export async function scanOnce(options: KeeperOptions): Promise<VaultResult[]> {
  const log = options.log ?? console.log;
  const paryon = deploymentContracts(options.provider, options.deployment);
  const results: VaultResult[] = [];
  for (const setupTxid of options.setupTxids) {
    let result: VaultResult;
    try {
      result = await checkVault(options, paryon, await loadVault(options.provider, setupTxid));
    } catch (error) {
      result = { setupTxid, action: 'skipped', reason: (error as Error).message };
    }
    log(summarize(result));
    results.push(result);
  }
  return results;
}

async function checkVault(options: KeeperOptions, paryon: ReturnType<typeof deploymentContracts>, vault: Vault): Promise<VaultResult> {
  const { provider } = options;
  const setupTxid = vault.setupTxid;
  const lookup = await findRescueUtxos(provider, paryon, options.deployment, vault);
  if (!lookup.found) return { setupTxid, action: 'skipped', reason: lookup.reason };
  const { utxos } = lookup;
  const state = readRescueState(utxos);
  const ratioBps = collateralRatioBps(state.collateralSats, state.debtCents, state.priceCents);
  const triggerPrice = priceAtRatio(state.collateralSats, state.debtCents, vault.params.triggerRatioBps);

  const feeRate = options.feeRate ?? 1;
  const wantReward = options.keeperLockingBytecode ? (options.keeperRewardSats ?? 0n) : 0n;
  // First pass with a generous fee guess, to measure the transaction size.
  const firstPlan = planRescue({ params: vault.params, ...state, overheadSats: vault.params.maxOverheadSats });
  if (!firstPlan.ok) {
    return {
      setupTxid, action: 'waiting', ratioBps,
      reason: `${firstPlan.reason}; loan at ${formatPercent(ratioBps)} at ${formatUsd(state.priceCents)}, rescue below ${formatUsd(triggerPrice)}`,
    };
  }

  const age = await utxoAgeBlocks(provider, utxos.reserve);
  if (age !== undefined && age < Number(vault.params.cooldownBlocks)) {
    return { setupTxid, action: 'waiting', ratioBps, reason: `reserve is in its cooldown (${age}/${vault.params.cooldownBlocks} blocks)` };
  }

  const build = (topUpSats: bigint, minerFeeSats: bigint, keeperRewardSats: bigint): TransactionParts => rescueParts({
    vault: vault.contract, params: vault.params, utxos, unlockers: paryonUnlockers(paryon, utxos.loan),
    topUpSats, minerFeeSats, keeperRewardSats, keeperLockingBytecode: options.keeperLockingBytecode,
  });
  const sizeProbe = assemble(provider, build(firstPlan.topUpSats, vault.params.maxOverheadSats - wantReward, wantReward)).build();
  const sizeBytes = sizeProbe.length / 2;
  const minerFeeSats = BigInt(Math.ceil(sizeBytes * feeRate)) + 10n;
  if (minerFeeSats > vault.params.maxOverheadSats) {
    return { setupTxid, action: 'skipped', reason: `miner fee ${minerFeeSats} sats is above this vault's overhead limit` };
  }
  const keeperRewardSats = wantReward < vault.params.maxOverheadSats - minerFeeSats ? wantReward : vault.params.maxOverheadSats - minerFeeSats;

  const plan = planRescue({ params: vault.params, ...state, overheadSats: minerFeeSats + keeperRewardSats });
  if (!plan.ok) return { setupTxid, action: 'waiting', ratioBps, reason: plan.reason };
  const parts = build(plan.topUpSats, minerFeeSats, keeperRewardSats);
  const builder = assemble(provider, parts);
  // Evaluate locally first: if the covenant or Paryon would reject it, say why instead of broadcasting.
  builder.debug();
  const hex = builder.build();

  const base = { setupTxid, topUpSats: plan.topUpSats, minerFeeSats, keeperRewardSats, hex };
  if (options.dryRun) {
    (options.log ?? console.log)(describeRescue({ vault, state, plan, parts, liquidationPriceCents: liquidationPriceCents(state.collateralSats, state.debtCents), hex }));
    return { ...base, action: 'would-rescue' };
  }
  const sent = await builder.send();
  return { ...base, action: 'rescued', txid: sent.txid };
}

function summarize(result: VaultResult): string {
  const id = result.setupTxid.slice(0, 12);
  switch (result.action) {
    case 'skipped': return `[${id}] skipped: ${result.reason}`;
    case 'waiting': return `[${id}] no rescue: ${result.reason}`;
    case 'would-rescue': return `[${id}] DRY RUN: would add ${formatBch(result.topUpSats)} to the loan (fee ${result.minerFeeSats} sats, reward ${result.keeperRewardSats} sats)`;
    case 'rescued': return `[${id}] RESCUED: added ${formatBch(result.topUpSats)} to the loan in ${result.txid}`;
  }
}
