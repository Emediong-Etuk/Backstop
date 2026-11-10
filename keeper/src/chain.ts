// Reading vaults, loans and prices from the chain. Everything comes from public chain data.
import type { NetworkProvider, SpendableUtxo } from 'cashscript';
import { binToHex, decodeTransaction, hexToBin, sha256 } from '@bitauth/libauth';
import {
  decodeSetupOutput, LOAN_SIDECAR_COMMITMENT, MANAGE_FUNCTION_COMMITMENT, parsePriceState, paryonContracts, vaultContract,
  type BackstopParams, type ParyonContracts, type RescueUtxos, type VaultContract,
} from '@backstop/contracts';
import type { Deployment } from './config.js';

export interface Vault {
  setupTxid: string;
  params: BackstopParams;
  contract: VaultContract;
}

/** Rebuilds a vault from its setup transaction's OP_RETURN. */
export async function loadVault(provider: NetworkProvider, setupTxid: string): Promise<Vault> {
  const tx = decodeTransaction(hexToBin(await provider.getRawTransaction(setupTxid)));
  if (typeof tx === 'string') throw new Error(`setup transaction ${setupTxid}: ${tx}`);
  for (const output of tx.outputs) {
    const params = decodeSetupOutput(binToHex(output.lockingBytecode));
    if (!params) continue;
    const contract = vaultContract(params, provider);
    // The setup transaction must actually have funded this vault.
    if (binToHex(tx.outputs[0].lockingBytecode) !== contract.lockingBytecode) {
      throw new Error(`setup transaction ${setupTxid}: output 0 does not pay the vault its OP_RETURN describes`);
    }
    return { setupTxid, params, contract };
  }
  throw new Error(`setup transaction ${setupTxid} has no Backstop OP_RETURN`);
}

export function deploymentContracts(provider: NetworkProvider, deployment: Deployment): ParyonContracts {
  return paryonContracts(provider, { oraclePublicKey: deployment.oraclePublicKey, migrationKeyCategory: deployment.migrationKeyCategory });
}

const hasNft = (u: SpendableUtxo, category: string, commitment?: string, capability?: string) =>
  u.token?.category === category && u.token.nft !== undefined
  && (commitment === undefined || u.token.nft.commitment === commitment)
  && (capability === undefined || u.token.nft.capability === capability);

export type Lookup =
  | { found: true; utxos: RescueUtxos }
  | { found: false; reason: string };

/** Finds every UTXO a rescue of this vault needs. */
export async function findRescueUtxos(provider: NetworkProvider, paryon: ParyonContracts, deployment: Deployment, vault: Vault): Promise<Lookup> {
  const { params } = vault;
  const vaultUtxos = await provider.getUtxosForLockingBytecode(vault.contract.lockingBytecode);
  const key = vaultUtxos.find((u) => hasNft(u, params.loanKeyCategory, '', 'minting'));
  if (!key) return { found: false, reason: 'vault no longer holds the loan key (withdrawn?)' };
  const reserve = vaultUtxos.filter((u) => !u.token).sort((a, b) => Number(b.satoshis - a.satoshis))[0];
  if (!reserve) return { found: false, reason: 'vault has no reserve left' };

  // The loan sidecar carries the loan-key category; the loan is the output just before it.
  const sidecar = (await provider.getUtxosForLockingBytecode(paryon.sidecar.lockingBytecode))
    .find((u) => hasNft(u, params.loanKeyCategory, LOAN_SIDECAR_COMMITMENT, 'none'));
  if (!sidecar) return { found: false, reason: 'loan not found (repaid or liquidated?)' };
  const loan = (await provider.getUtxosForLockingBytecode(paryon.loan.lockingBytecode))
    .find((u) => u.txid === sidecar.txid && u.vout === sidecar.vout - 1 && hasNft(u, deployment.paryonTokenId, undefined, 'mutable'));
  if (!loan) return { found: false, reason: 'loan output next to the sidecar not found' };

  // An honest keeper uses the freshest price thread.
  const price = (await provider.getUtxosForLockingBytecode(paryon.price.lockingBytecode))
    .filter((u) => hasNft(u, deployment.paryonTokenId, undefined, 'mutable') && u.token!.nft!.commitment.startsWith('00'))
    .sort((a, b) => Number(parsePriceState(b.token!.nft!.commitment).sequence - parsePriceState(a.token!.nft!.commitment).sequence))[0];
  if (!price) return { found: false, reason: 'no price contract found' };

  const manageThreads = (await provider.getUtxosForLockingBytecode(paryon.manage.lockingBytecode))
    .filter((u) => hasNft(u, deployment.paryonTokenId, MANAGE_FUNCTION_COMMITMENT, 'none'));
  // Several keepers or borrowers may use these threads at once; pick one at random.
  const manage = manageThreads[Math.floor(Math.random() * manageThreads.length)];
  if (!manage) return { found: false, reason: 'no manage function thread found' };

  return { found: true, utxos: { price, loan, sidecar, manage, key, reserve } };
}

/**
 * Age of a UTXO in blocks, when the provider can tell (Electrum). The cooldown is enforced by
 * the node through the relative timelock; this only saves broadcasting a transaction too early.
 */
export async function utxoAgeBlocks(provider: NetworkProvider, utxo: SpendableUtxo): Promise<number | undefined> {
  const electrum = provider as NetworkProvider & { performRequest?: (method: string, ...params: unknown[]) => Promise<unknown> };
  if (typeof electrum.performRequest !== 'function') return undefined;
  // Electrum addresses scripts by the reversed SHA-256 of their locking bytecode.
  const scriptHash = binToHex(sha256.hash(hexToBin(utxo.lockingBytecode)).reverse());
  const entries = await electrum.performRequest('blockchain.scripthash.listunspent', scriptHash, 'include_tokens') as Array<{ tx_hash: string; tx_pos: number; height: number }>;
  const entry = entries.find((e) => e.tx_hash === utxo.txid && e.tx_pos === utxo.vout);
  if (!entry || entry.height <= 0) return 0;
  return (await provider.getBlockHeight()) - entry.height + 1;
}
