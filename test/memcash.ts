// A CashScript NetworkProvider backed by @paryonusd/mem-cash: an in-memory node that checks
// transactions the way BCHN does (including BIP68 relative timelocks, standardness and fees) and
// answers the Electrum protocol the way Fulcrum does. The keeper talks to it through the same
// Electrum calls it makes on chipnet.
import type { NetworkProvider, SpendableUtxo, Utxo } from 'cashscript';
import { binToHex, cashAddressToLockingBytecode, hexToBin, sha256 } from '@bitauth/libauth';
import { createIndexer } from '@paryonusd/mem-cash';
import { createTxVerifier } from '@paryonusd/mem-cash/validation';

const scriptHashOf = (lockingBytecode: string) => binToHex(sha256.hash(hexToBin(lockingBytecode)).reverse());

export class MemCashProvider implements NetworkProvider {
  readonly network = 'chipnet' as const;
  readonly indexer = createIndexer({ verifier: createTxVerifier({ vmVersion: 'BCH_2026_05', standard: true }), addressPrefix: 'bchtest' });

  private tip: number;

  constructor(startHeight = 300_000) {
    this.tip = startHeight;
    this.indexer.setChainTip(startHeight, 1_794_000_000);
  }

  /** Electrum request, as ElectrumNetworkProvider.performRequest. */
  async performRequest(method: string, ...params: unknown[]): Promise<unknown> {
    return this.indexer.request(method as never, params as never);
  }

  async getUtxos(address: string): Promise<SpendableUtxo[]> {
    const decoded = cashAddressToLockingBytecode(address);
    if (typeof decoded === 'string') throw new Error(decoded);
    return this.getUtxosForLockingBytecode(binToHex(decoded.bytecode));
  }

  async getUtxosForLockingBytecode(lockingBytecode: Uint8Array | string): Promise<SpendableUtxo[]> {
    const hex = typeof lockingBytecode === 'string' ? lockingBytecode : binToHex(lockingBytecode);
    const result = await this.performRequest('blockchain.scripthash.listunspent', scriptHashOf(hex), 'include_tokens') as Array<{
      tx_hash: string; tx_pos: number; value: number; token_data?: { category: string; amount: string; nft?: { capability: 'none' | 'mutable' | 'minting'; commitment: string } };
    }>;
    // Same mapping as CashScript's ElectrumNetworkProvider.
    return result.map((u) => ({
      txid: u.tx_hash, vout: u.tx_pos, satoshis: BigInt(u.value), lockingBytecode: hex,
      token: u.token_data ? { ...u.token_data, amount: BigInt(u.token_data.amount) } : undefined,
    }));
  }

  async getBlockHeight(): Promise<number> {
    const { height } = await this.performRequest('blockchain.headers.get_tip') as { height: number };
    return height;
  }

  async getRawTransaction(txid: string): Promise<string> {
    return await this.performRequest('blockchain.transaction.get', txid) as string;
  }

  async sendRawTransaction(txHex: string): Promise<string> {
    return await this.performRequest('blockchain.transaction.broadcast', txHex) as string;
  }

  /** Seeds a confirmed UTXO, `ageBlocks` deep (MockNetworkProvider-compatible signature). */
  addUtxo(lockingBytecode: string, utxo: Utxo, ageBlocks = 100): SpendableUtxo {
    this.indexer.addUtxo({
      txid: utxo.txid, vout: utxo.vout, satoshis: utxo.satoshis,
      scriptHash: scriptHashOf(lockingBytecode), lockingBytecode: hexToBin(lockingBytecode),
      height: this.tip - ageBlocks,
      tokenData: utxo.token,
    });
    return { ...utxo, lockingBytecode };
  }

  mine(blocks = 1): void {
    for (let i = 0; i < blocks; i++) this.tip = this.indexer.mine().height;
  }
}
