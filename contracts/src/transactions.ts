// Builders for the three Backstop transactions: setup, rescue and withdraw.
// These builders are a convenience only. The covenant enforces every rule, so a keeper that
// builds a rescue by hand gets the same guarantees for the borrower.
import { TransactionBuilder, type NetworkProvider, type Output, type SpendableUtxo, type Unlocker, type InputOptions, SignatureTemplate } from 'cashscript';
import { hexToBin } from '@bitauth/libauth';
import { PARYON_DUST, parseLoanState, parsePriceState, type ParyonContracts } from './paryon.js';
import { collateralRatioBps, isBelowRatio, maxCollateralAtRatio, PARYON_MIN_RATIO_BPS } from './ratio.js';
import { setupOpReturnChunks, type BackstopParams, type VaultContract } from './vault.js';

/** The reserve UTXO never goes below this, so it always stays a valid output. */
export const RESERVE_DUST = 1_000n;
/** Mirrors the covenant's "reserve is used up" slack (Backstop.cash: maxOverheadSats + 2000). */
const RESERVE_USED_UP_SLACK = 2_000n;

export interface TransactionParts {
  inputs: Array<{ utxo: SpendableUtxo; unlocker: Unlocker; options?: InputOptions }>;
  outputs: Output[];
}

export function assemble(provider: NetworkProvider, parts: TransactionParts): TransactionBuilder {
  const builder = new TransactionBuilder({ provider });
  for (const input of parts.inputs) builder.addInput(input.utxo, input.unlocker, input.options);
  builder.addOutputs(parts.outputs);
  return builder;
}

/** Sends a UTXO's token and value back to the locking bytecode it came from. */
function returnUnchanged(utxo: SpendableUtxo, satoshis = utxo.satoshis): Output {
  return { to: hexToBin(utxo.lockingBytecode), amount: satoshis, token: utxo.token };
}

// ---------------------------------------------------------------------------
// Rescue
// ---------------------------------------------------------------------------

export type RescuePlan =
  | { ok: true; topUpSats: bigint; ratioBeforeBps: bigint; ratioAfterBps: bigint }
  | { ok: false; reason: string; ratioBeforeBps?: bigint };

/**
 * Works out the top-up for a rescue, following the same rules the covenant checks.
 * `availableSats` is what the reserve can give after the overhead this rescue will spend.
 */
export function planRescue(args: {
  params: BackstopParams;
  collateralSats: bigint;
  debtCents: bigint;
  priceCents: bigint;
  reserveSats: bigint;
  overheadSats: bigint;
}): RescuePlan {
  const { params, collateralSats, debtCents, priceCents, reserveSats, overheadSats } = args;
  if (overheadSats > params.maxOverheadSats) return { ok: false, reason: 'overhead is above the vault limit' };
  const ratioBeforeBps = collateralRatioBps(collateralSats, debtCents, priceCents);
  if (!isBelowRatio(collateralSats, debtCents, priceCents, params.triggerRatioBps)) {
    return { ok: false, reason: 'loan is not below the trigger ratio', ratioBeforeBps };
  }
  const neededSats = maxCollateralAtRatio(debtCents, priceCents, params.targetRatioBps) - collateralSats;
  const availableSats = reserveSats - overheadSats - RESERVE_DUST;
  const topUpSats = [neededSats, params.maxTopUpSats, availableSats].reduce((a, b) => (a < b ? a : b));
  if (topUpSats <= 0n) return { ok: false, reason: 'reserve is empty', ratioBeforeBps };

  const after = collateralSats + topUpSats;
  if (isBelowRatio(after, debtCents, priceCents, PARYON_MIN_RATIO_BPS)) {
    return { ok: false, reason: 'the reserve cannot lift the loan above Paryon\'s 110% minimum', ratioBeforeBps };
  }
  const lifted = !isBelowRatio(after, debtCents, priceCents, params.triggerRatioBps);
  const reserveUsedUp = reserveSats - topUpSats <= params.maxOverheadSats + RESERVE_USED_UP_SLACK;
  if (!lifted && topUpSats !== params.maxTopUpSats && !reserveUsedUp) {
    return { ok: false, reason: 'rescue would be too small to lift the loan above the trigger', ratioBeforeBps };
  }
  return { ok: true, topUpSats, ratioBeforeBps, ratioAfterBps: collateralRatioBps(after, debtCents, priceCents) };
}

export interface RescueUtxos {
  price: SpendableUtxo;
  loan: SpendableUtxo;
  sidecar: SpendableUtxo;
  manage: SpendableUtxo;
  key: SpendableUtxo;
  reserve: SpendableUtxo;
}

export interface ParyonUnlockers {
  price: Unlocker;
  loan: Unlocker;
  sidecar: Unlocker;
  manage: Unlocker;
}

/** Unlockers for Paryon's real contracts on the add-collateral path. */
export function paryonUnlockers(paryon: ParyonContracts, loanUtxo: SpendableUtxo): ParyonUnlockers {
  const commitment = loanUtxo.token?.nft?.commitment;
  if (!commitment) throw new Error('loan UTXO has no state');
  // Passing the loan's current interest-manager setting keeps its state unchanged, which Backstop requires.
  const { interestManagerConfiguration } = parseLoanState(commitment);
  return {
    price: paryon.price.unlock.sharePrice(),
    loan: paryon.loan.unlock.interact(),
    sidecar: paryon.sidecar.unlock.attach(),
    manage: paryon.manage.unlock.manage(0n, interestManagerConfiguration),
  };
}

/**
 * The parts of a rescue transaction. Layout (see Backstop.cash):
 * in  0 price, 1 loan, 2 sidecar, 3 manage, 4 vault key, 5 vault reserve
 * out 0 price, 1 loan + topUp, 2 sidecar, 3 manage, 4 vault key, 5 vault reserve, 6? keeper reward
 */
export function rescueParts(args: {
  vault: VaultContract;
  params: BackstopParams;
  utxos: RescueUtxos;
  unlockers: ParyonUnlockers;
  topUpSats: bigint;
  minerFeeSats: bigint;
  keeperRewardSats?: bigint;
  /** Where the keeper reward goes. Required if keeperRewardSats > 0. */
  keeperLockingBytecode?: string;
}): TransactionParts {
  const { vault, params, utxos, unlockers, topUpSats, minerFeeSats } = args;
  const keeperRewardSats = args.keeperRewardSats ?? 0n;
  const reserveBack = utxos.reserve.satoshis - topUpSats - minerFeeSats - keeperRewardSats;
  const rescue = vault.unlock.rescue();

  const outputs: Output[] = [
    returnUnchanged(utxos.price, PARYON_DUST),
    returnUnchanged(utxos.loan, utxos.loan.satoshis + topUpSats),
    returnUnchanged(utxos.sidecar, PARYON_DUST),
    returnUnchanged(utxos.manage, PARYON_DUST),
    returnUnchanged(utxos.key),
    { to: hexToBin(utxos.reserve.lockingBytecode), amount: reserveBack },
  ];
  if (keeperRewardSats > 0n) {
    if (!args.keeperLockingBytecode) throw new Error('keeperLockingBytecode is required for a keeper reward');
    outputs.push({ to: hexToBin(args.keeperLockingBytecode), amount: keeperRewardSats });
  }

  return {
    inputs: [
      { utxo: utxos.price, unlocker: unlockers.price },
      { utxo: utxos.loan, unlocker: unlockers.loan },
      { utxo: utxos.sidecar, unlocker: unlockers.sidecar },
      { utxo: utxos.manage, unlocker: unlockers.manage },
      { utxo: utxos.key, unlocker: rescue },
      // The reserve input declares the cooldown as a relative timelock (nSequence, BIP68).
      { utxo: utxos.reserve, unlocker: rescue, options: { sequence: Number(params.cooldownBlocks) } },
    ],
    outputs,
  };
}

/** Reads the numbers a rescue depends on straight from the UTXOs. */
export function readRescueState(utxos: Pick<RescueUtxos, 'price' | 'loan' | 'reserve'>) {
  const priceCommitment = utxos.price.token?.nft?.commitment;
  const loanCommitment = utxos.loan.token?.nft?.commitment;
  if (!priceCommitment || !loanCommitment) throw new Error('price or loan UTXO has no state');
  const { priceCents } = parsePriceState(priceCommitment);
  const { debtCents } = parseLoanState(loanCommitment);
  return { priceCents, debtCents, collateralSats: utxos.loan.satoshis, reserveSats: utxos.reserve.satoshis };
}

// ---------------------------------------------------------------------------
// Setup and withdraw (owner transactions, one wallet signature each)
// ---------------------------------------------------------------------------

/**
 * Setup: the borrower's wallet moves the loan key and the reserve into the vault and publishes
 * the vault's parameters in an OP_RETURN, so keepers can find and rebuild it from chain data.
 * out 0 vault key UTXO, 1 vault reserve UTXO, 2 OP_RETURN, 3? change
 */
export function setupParts(args: {
  vault: VaultContract;
  params: BackstopParams;
  keyUtxo: SpendableUtxo;
  fundingUtxos: SpendableUtxo[];
  ownerSigner: SignatureTemplate;
  reserveSats: bigint;
  minerFeeSats: bigint;
  changeLockingBytecode: string;
}): TransactionParts & { opReturn: string[] } {
  const { vault, params, keyUtxo, fundingUtxos, ownerSigner, reserveSats, minerFeeSats } = args;
  const unlocker = ownerSigner.unlockP2PKH();
  const inputs = [keyUtxo, ...fundingUtxos].map((utxo) => ({ utxo, unlocker }));
  const totalIn = [keyUtxo, ...fundingUtxos].reduce((sum, u) => sum + u.satoshis, 0n);
  const change = totalIn - PARYON_DUST - reserveSats - minerFeeSats;
  if (change < 0n) throw new Error('not enough BCH for the reserve and fee');

  const outputs: Output[] = [
    { to: hexToBin(vault.lockingBytecode), amount: PARYON_DUST, token: keyUtxo.token },
    { to: hexToBin(vault.lockingBytecode), amount: reserveSats },
  ];
  if (change >= 546n) outputs.push({ to: hexToBin(args.changeLockingBytecode), amount: change });
  // The OP_RETURN goes between the vault outputs and the change; see buildSetup.
  return { inputs, outputs, opReturn: setupOpReturnChunks(params) };
}

export function buildSetup(provider: NetworkProvider, parts: ReturnType<typeof setupParts>): TransactionBuilder {
  const builder = new TransactionBuilder({ provider });
  for (const input of parts.inputs) builder.addInput(input.utxo, input.unlocker);
  builder.addOutputs(parts.outputs.slice(0, 2));
  builder.addOpReturnOutput(parts.opReturn);
  builder.addOutputs(parts.outputs.slice(2));
  return builder;
}

/** Withdraw everything: the owner takes the key and the whole reserve back. */
export function withdrawParts(args: {
  vault: VaultContract;
  key: SpendableUtxo;
  reserve: SpendableUtxo;
  ownerSigner: SignatureTemplate;
  minerFeeSats: bigint;
  toLockingBytecode: string;
}): TransactionParts {
  const { vault, key, reserve, ownerSigner, minerFeeSats } = args;
  const unlocker = vault.unlock.ownerSpend(ownerSigner.publicKey, ownerSigner);
  const to = hexToBin(args.toLockingBytecode);
  return {
    inputs: [{ utxo: key, unlocker }, { utxo: reserve, unlocker }],
    outputs: [
      { to, amount: key.satoshis, token: key.token },
      { to, amount: reserve.satoshis - minerFeeSats },
    ],
  };
}
