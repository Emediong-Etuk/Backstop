import { binToHex } from '@bitauth/libauth';
import { collateralRatioBps, SATS_PER_BCH, type RescuePlan, type TransactionParts } from '@backstop/contracts';
import type { Vault } from '@backstop/contracts';

export function formatBch(sats: bigint): string {
  const negative = sats < 0n;
  const abs = negative ? -sats : sats;
  const whole = abs / SATS_PER_BCH;
  const frac = (abs % SATS_PER_BCH).toString().padStart(8, '0');
  return `${negative ? '-' : ''}${whole}.${frac} BCH`;
}

export function formatUsd(cents: bigint): string {
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

export function formatPercent(bps: bigint): string {
  return `${(Number(bps) / 100).toFixed(2)}%`;
}

const NAMES = ['price contract', 'loan', 'loan sidecar', 'manage function', 'vault key', 'vault reserve', 'keeper reward'];

/** Human-readable description of a rescue transaction, for dry runs. */
export function describeRescue(args: {
  vault: Vault;
  state: { priceCents: bigint; debtCents: bigint; collateralSats: bigint; reserveSats: bigint };
  plan: Extract<RescuePlan, { ok: true }>;
  parts: TransactionParts;
  liquidationPriceCents: bigint;
  hex: string;
}): string {
  const { vault, state, plan, parts, hex } = args;
  const after = state.collateralSats + plan.topUpSats;
  const lines = [
    '',
    `Rescue for vault ${vault.contract.address}`,
    `  price            ${formatUsd(state.priceCents)} per BCH`,
    `  debt             ${formatUsd(state.debtCents)} PUSD`,
    `  collateral       ${formatBch(state.collateralSats)} -> ${formatBch(after)}`,
    `  ratio            ${formatPercent(plan.ratioBeforeBps)} -> ${formatPercent(collateralRatioBps(after, state.debtCents, state.priceCents))}`,
    `  liquidation at   ${formatUsd(args.liquidationPriceCents)} before this rescue`,
    `  reserve          ${formatBch(state.reserveSats)} -> ${formatBch(parts.outputs[5].amount)}`,
    '  inputs:',
    ...parts.inputs.map((input, i) => `    ${i}  ${NAMES[i].padEnd(16)} ${input.utxo.txid}:${input.utxo.vout}  ${formatBch(input.utxo.satoshis)}`),
    '  outputs:',
    ...parts.outputs.map((output, i) => `    ${i}  ${NAMES[i].padEnd(16)} ${typeof output.to === 'string' ? output.to : binToHex(output.to)}  ${formatBch(output.amount)}${output.token ? '  + token' : ''}`),
    `  size             ${hex.length / 2} bytes`,
    `  raw transaction  ${hex}`,
    '',
  ];
  return lines.join('\n');
}
