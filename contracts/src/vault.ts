// Vault parameters, the Backstop contract instance, and the setup OP_RETURN that lets anyone
// rebuild a vault from chain data alone (no registry, no database).
import { Contract, type NetworkProvider } from 'cashscript';
import { decodeAuthenticationInstructions, hexToBin, binToHex, utf8ToBin } from '@bitauth/libauth';
import BackstopArtifact from '../artifacts/Backstop.artifact.js';
import { assertHex, readUintLE, reverseHex, uintLE } from './bytes.js';
import { PARYON_MIN_RATIO_BPS } from './ratio.js';

export { BackstopArtifact };

export interface BackstopParams {
  /** Borrower's public key hash, hex (20 bytes). */
  ownerPkh: string;
  /** Loan key token category, display order hex (as shown by wallets and explorers). */
  loanKeyCategory: string;
  /** Paryon token category, display order hex. */
  paryonTokenId: string;
  /** Locking bytecode of Paryon's manage function contract, hex. */
  manageLockingBytecode: string;
  triggerRatioBps: bigint;
  targetRatioBps: bigint;
  maxTopUpSats: bigint;
  maxOverheadSats: bigint;
  cooldownBlocks: bigint;
}

/** Sensible defaults for a borrower who has not chosen otherwise. */
export const DEFAULT_RULES = {
  triggerRatioBps: 12_500n, // rescue when the loan falls below 125%
  targetRatioBps: 15_000n, // lift it back to at most 150%
  maxOverheadSats: 10_000n, // at most 0.0001 BCH per rescue for fee + keeper reward
  cooldownBlocks: 6n, // about an hour between rescues
} as const;

/**
 * Checks that make a vault sensible to set up. These are not security checks: the covenant
 * protects the borrower whatever the values are. They stop a borrower locking up a vault that
 * can never rescue, or that rescues too late.
 */
export function validateParams(p: BackstopParams): void {
  assertHex(p.ownerPkh, 20, 'ownerPkh');
  assertHex(p.loanKeyCategory, 32, 'loanKeyCategory');
  assertHex(p.paryonTokenId, 32, 'paryonTokenId');
  if (p.manageLockingBytecode.length === 0 || p.manageLockingBytecode.length > 255 * 2) throw new Error('manageLockingBytecode has an invalid length');
  if (p.triggerRatioBps <= PARYON_MIN_RATIO_BPS) throw new Error('The trigger must be above Paryon\'s 110% liquidation ratio');
  if (p.targetRatioBps <= p.triggerRatioBps) throw new Error('The target must be above the trigger');
  if (p.targetRatioBps > 65_535n) throw new Error('The target must be at most 655.35%');
  if (p.maxTopUpSats <= 0n) throw new Error('The top-up limit must be positive');
  if (p.maxOverheadSats < 1_000n || p.maxOverheadSats > 0xffff_ffffn) throw new Error('The fee limit must be between 1000 and 2^32-1 sats');
  if (p.cooldownBlocks < 0n || p.cooldownBlocks > 65_535n) throw new Error('The cooldown must be 0 to 65535 blocks');
}

/** Constructor arguments in contract order. Categories are reversed into the byte order the script sees. */
export function constructorArgs(p: BackstopParams) {
  return [
    p.ownerPkh,
    reverseHex(p.loanKeyCategory),
    reverseHex(p.paryonTokenId),
    p.manageLockingBytecode,
    p.triggerRatioBps,
    p.targetRatioBps,
    p.maxTopUpSats,
    p.maxOverheadSats,
    p.cooldownBlocks,
  ] as const;
}

export function vaultContract(p: BackstopParams, provider: NetworkProvider) {
  validateParams(p);
  return new Contract(BackstopArtifact, [...constructorArgs(p)], { provider, contractType: 'p2sh32' });
}

export type VaultContract = ReturnType<typeof vaultContract>;

// ---- Setup OP_RETURN ----
// OP_RETURN <"BKSP"> <payload>
// payload v1: version 0x01 | ownerPkh 20 | loanKeyCategory 32 | paryonTokenId 32
//           | manageLen 1 | manageLockingBytecode | trigger u16 | target u16
//           | maxTopUp u64 | maxOverhead u32 | cooldown u16   (integers little-endian)

export const SETUP_PREFIX = 'BKSP';
const SETUP_PREFIX_HEX = binToHex(utf8ToBin(SETUP_PREFIX));
const SETUP_VERSION = '01';

export function encodeSetupPayload(p: BackstopParams): string {
  validateParams(p);
  return SETUP_VERSION
    + p.ownerPkh
    + p.loanKeyCategory
    + p.paryonTokenId
    + uintLE(p.manageLockingBytecode.length / 2, 1) + p.manageLockingBytecode
    + uintLE(p.triggerRatioBps, 2)
    + uintLE(p.targetRatioBps, 2)
    + uintLE(p.maxTopUpSats, 8)
    + uintLE(p.maxOverheadSats, 4)
    + uintLE(p.cooldownBlocks, 2);
}

/** Chunks for CashScript's `TransactionBuilder.addOpReturnOutput`. */
export function setupOpReturnChunks(p: BackstopParams): string[] {
  return [SETUP_PREFIX, '0x' + encodeSetupPayload(p)];
}

export function decodeSetupPayload(payloadHex: string): BackstopParams {
  let at = 0;
  const take = (bytes: number) => {
    const part = payloadHex.slice(at, at + bytes * 2);
    if (part.length !== bytes * 2) throw new Error('setup payload is truncated');
    at += bytes * 2;
    return part;
  };
  if (take(1) !== SETUP_VERSION) throw new Error('unknown setup payload version');
  const ownerPkh = take(20);
  const loanKeyCategory = take(32);
  const paryonTokenId = take(32);
  const manageLockingBytecode = take(Number(readUintLE(take(1))));
  const params: BackstopParams = {
    ownerPkh,
    loanKeyCategory,
    paryonTokenId,
    manageLockingBytecode,
    triggerRatioBps: readUintLE(take(2)),
    targetRatioBps: readUintLE(take(2)),
    maxTopUpSats: readUintLE(take(8)),
    maxOverheadSats: readUintLE(take(4)),
    cooldownBlocks: readUintLE(take(2)),
  };
  if (at !== payloadHex.length) throw new Error('setup payload has trailing bytes');
  validateParams(params);
  return params;
}

/** Returns the vault parameters if this output is a Backstop setup OP_RETURN, otherwise undefined. */
export function decodeSetupOutput(lockingBytecodeHex: string): BackstopParams | undefined {
  const bytes = hexToBin(lockingBytecodeHex);
  if (bytes[0] !== 0x6a) return undefined;
  const instructions = decodeAuthenticationInstructions(bytes.slice(1));
  if (instructions.length !== 2) return undefined;
  const [prefix, payload] = instructions.map((i) => ('data' in i ? binToHex(i.data) : undefined));
  if (prefix !== SETUP_PREFIX_HEX || payload === undefined) return undefined;
  try {
    return decodeSetupPayload(payload);
  } catch {
    return undefined;
  }
}
