// Keeper configuration files. Neither holds anything secret.
import { readFileSync } from 'node:fs';

export type { Deployment } from '@backstop/contracts';

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
