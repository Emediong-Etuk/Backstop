// Reading vaults, loans and prices from the chain. Everything comes from public chain data.
// Shared by the keeper and the web app, so nothing here may depend on Node.
import type { NetworkProvider, SpendableUtxo } from 'cashscript';
import { binToHex, decodeTransaction, hexToBin, sha256 } from '@bitauth/libauth';
import { LOAN_SIDECAR_COMMITMENT, MANAGE_FUNCTION_COMMITMENT, parsePriceState, paryonContracts, type ParyonContracts } from './paryon.js';
import { decodeSetupOutput, vaultContract, type BackstopParams, type VaultContract } from './vault.js';
import type { RescueUtxos } from './transactions.js';

/** Where Paryon's contracts live on a network. On chipnet: our demo deployment (see deployments/). */
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

// ---------------------------------------------------------------------------
// Lookups for the web app. They need an Electrum-style provider (performRequest), which
// CashScript's ElectrumNetworkProvider is, so history can be read without any indexer of ours.
// ---------------------------------------------------------------------------

type ElectrumLike = NetworkProvider & { performRequest(method: string, ...params: (string | number | boolean)[]): Promise<unknown> };

function electrum(provider: NetworkProvider): ElectrumLike {
  const p = provider as ElectrumLike;
  if (typeof p.performRequest !== 'function') throw new Error('this lookup needs an Electrum network provider');
  return p;
}

const scriptHashOf = (lockingBytecode: string) => binToHex(sha256.hash(hexToBin(lockingBytecode)).reverse());

export async function history(provider: NetworkProvider, lockingBytecode: string): Promise<Array<{ txid: string; height: number }>> {
  const entries = await electrum(provider).performRequest('blockchain.scripthash.get_history', scriptHashOf(lockingBytecode)) as Array<{ tx_hash: string; height: number }>;
  return entries.map((e) => ({ txid: e.tx_hash, height: e.height }));
}

/** Unix time of a block, read from its 80-byte header. */
export async function blockTime(provider: NetworkProvider, height: number): Promise<number | undefined> {
  if (height <= 0) return undefined;
  const header = hexToBin(await electrum(provider).performRequest('blockchain.block.header', height) as string);
  return header[68] | (header[69] << 8) | (header[70] << 16) | (header[71] * 2 ** 24);
}

export interface WalletLoan {
  loanKey: SpendableUtxo;
  loan: SpendableUtxo;
  loanKeyCategory: string;
}

/** Paryon loans whose loan key sits in this wallet. */
export async function findWalletLoans(provider: NetworkProvider, paryon: ParyonContracts, deployment: Deployment, walletLockingBytecode: string): Promise<WalletLoan[]> {
  const keys = (await provider.getUtxosForLockingBytecode(walletLockingBytecode)).filter((u) => u.token?.nft?.capability === 'minting');
  if (keys.length === 0) return [];
  const sidecars = await provider.getUtxosForLockingBytecode(paryon.sidecar.lockingBytecode);
  const loans = await provider.getUtxosForLockingBytecode(paryon.loan.lockingBytecode);
  const found: WalletLoan[] = [];
  for (const key of keys) {
    const sidecar = sidecars.find((s) => hasNft(s, key.token!.category, LOAN_SIDECAR_COMMITMENT, 'none'));
    const loan = sidecar && loans.find((l) => l.txid === sidecar.txid && l.vout === sidecar.vout - 1 && hasNft(l, deployment.paryonTokenId, undefined, 'mutable'));
    if (loan) found.push({ loanKey: key, loan, loanKeyCategory: key.token!.category });
  }
  return found;
}

/** Vaults this wallet set up, found from its own transaction history (no registry). */
export async function findOwnedVaults(provider: NetworkProvider, ownerPkh: string, walletLockingBytecode: string): Promise<Vault[]> {
  const vaults: Vault[] = [];
  for (const { txid } of await history(provider, walletLockingBytecode)) {
    const tx = decodeTransaction(hexToBin(await provider.getRawTransaction(txid)));
    if (typeof tx === 'string') continue;
    const params = tx.outputs.map((o) => decodeSetupOutput(binToHex(o.lockingBytecode))).find((p) => p !== undefined);
    if (params && params.ownerPkh === ownerPkh) {
      try { vaults.push(await loadVault(provider, txid)); } catch { /* not a valid setup */ }
    }
  }
  return vaults;
}

export type VaultEvent =
  | { kind: 'setup'; txid: string; height: number; reserveSats: bigint }
  | { kind: 'rescue'; txid: string; height: number; topUpSats: bigint; overheadSats: bigint; reserveAfterSats: bigint }
  | { kind: 'withdraw'; txid: string; height: number };

/** What happened to a vault, from the chain alone. */
export async function vaultHistory(provider: NetworkProvider, vault: Vault): Promise<VaultEvent[]> {
  const events: VaultEvent[] = [];
  const rawCache = new Map<string, ReturnType<typeof decodeTransaction>>();
  const getTx = async (txid: string) => {
    if (!rawCache.has(txid)) rawCache.set(txid, decodeTransaction(hexToBin(await provider.getRawTransaction(txid))));
    const tx = rawCache.get(txid)!;
    if (typeof tx === 'string') throw new Error(tx);
    return tx;
  };
  const vaultBytecode = vault.contract.lockingBytecode;
  for (const { txid, height } of await history(provider, vaultBytecode)) {
    const tx = await getTx(txid);
    const pays = (i: number) => tx.outputs[i] && binToHex(tx.outputs[i].lockingBytecode) === vaultBytecode;
    if (txid === vault.setupTxid) {
      events.push({ kind: 'setup', txid, height, reserveSats: tx.outputs[1].valueSatoshis });
    } else if (tx.inputs.length === 6 && pays(4) && pays(5)) {
      const prevLoan = await getTx(binToHex(tx.inputs[1].outpointTransactionHash));
      const prevReserve = await getTx(binToHex(tx.inputs[5].outpointTransactionHash));
      const topUpSats = tx.outputs[1].valueSatoshis - prevLoan.outputs[tx.inputs[1].outpointIndex].valueSatoshis;
      const reserveBefore = prevReserve.outputs[tx.inputs[5].outpointIndex].valueSatoshis;
      const reserveAfterSats = tx.outputs[5].valueSatoshis;
      events.push({ kind: 'rescue', txid, height, topUpSats, overheadSats: reserveBefore - topUpSats - reserveAfterSats, reserveAfterSats });
    } else if (!tx.outputs.some((_, i) => pays(i))) {
      events.push({ kind: 'withdraw', txid, height });
    }
  }
  return events;
}
