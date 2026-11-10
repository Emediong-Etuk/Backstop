// Keeper configuration files. Neither holds anything secret.
import { readFileSync } from 'node:fs';

/** Where Paryon's contracts live on a network. Written by the chipnet deploy script. */
export interface Deployment {
  network: 'chipnet' | 'mainnet' | 'mock';
  /** Display-order hex. */
  paryonTokenId: string;
  /** Public key of the oracle the price contract accepts. On chipnet this is the DEMO oracle. */
  oraclePublicKey: string;
  /** Display-order hex; part of the price contract's address. */
  migrationKeyCategory: string;
  /** Free-form note shown in logs, e.g. "demo deployment, not Paryon's". */
  label?: string;
}

/**
 * Vault discovery for the demo: a list of setup transaction IDs. The keeper reads each setup
 * transaction from the chain and rebuilds the vault from its OP_RETURN, so this file holds no
 * vault data of its own. (On a network with an indexer such as ChainGraph, the same list could
 * come from a query for OP_RETURNs starting with "BKSP".)
 */
export interface VaultList {
  vaults: Array<{ setupTxid: string; note?: string }>;
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
