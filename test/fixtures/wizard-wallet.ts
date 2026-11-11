// TEST ONLY. A WizardConnect wallet: an HD key behind @wizardconnect/wallet's real
// WalletConnectionManager, signing the way the protocol requires. It signs only the inputs listed
// in inputPaths, as P2PKH inputs, with SIGHASH_ALL | SIGHASH_FORKID | SIGHASH_UTXOS. Contract
// inputs keep the unlocking bytecode the dapp set.
import {
  binToHex, decodeTransaction, deriveHdPath, deriveHdPrivateNodeChild, deriveHdPrivateNodeFromSeed, deriveHdPublicNode, encodeDataPush, encodeHdPublicKey,
  encodeTransaction, generateSigningSerializationBCH, hash160, hexToBin, secp256k1, sha256, utf8ToBin,
  type HdPrivateNodeValid, type Output,
} from '@bitauth/libauth';
import { toBigInt, toUint8Array } from '@wizardconnect/core';
import { WalletConnectionManager, type WalletAdapter } from '@wizardconnect/wallet';

const SIGHASH_ALL_FORKID_UTXOS = 0x61;
const PATHS: Record<string, number> = { receive: 0, change: 1, defi: 7 };

export function startWizardWallet(label: string) {
  const master = deriveHdPrivateNodeFromSeed(sha256.hash(utf8ToBin(`backstop wizard wallet ${label}`))) as HdPrivateNodeValid;
  const chain = (path: number) => deriveHdPath(master, `m/44'/145'/0'/${path}`) as HdPrivateNodeValid;
  const childKey = (path: number, index: bigint) => deriveHdPrivateNodeChild(chain(path), Number(index)).privateKey;
  const publicKey = (path: number, index: bigint) => secp256k1.derivePublicKeyCompressed(childKey(path, index)) as Uint8Array;
  const signRequests: number[] = [];

  const adapter: WalletAdapter = {
    walletName: `Test HD wallet (${label})`,
    walletIcon: '',
    getRelayPrivateKey: () => sha256.hash(utf8ToBin(`relay key ${label}`)),
    getPublicKey: (path, index) => publicKey(path as number, index),
    getXpub: (path) => {
      const encoded = encodeHdPublicKey({ network: 'testnet', node: deriveHdPublicNode(chain(path as number)) });
      if (typeof encoded === 'string') throw new Error(encoded);
      return encoded.hdPublicKey;
    },
    async signTransaction(request) {
      signRequests.push(request.sequence);
      const wc = request.transaction as unknown as { transaction: string; sourceOutputs: Array<Record<string, any>> };
      const transaction = decodeTransaction(hexToBin(wc.transaction));
      if (typeof transaction === 'string') throw new Error(transaction);
      const sourceOutputs: Output[] = wc.sourceOutputs.map((so) => ({
        lockingBytecode: toUint8Array(so.lockingBytecode),
        valueSatoshis: toBigInt(so.valueSatoshis),
        ...(so.token ? {
          token: {
            category: toUint8Array(so.token.category),
            amount: toBigInt(so.token.amount),
            ...(so.token.nft ? { nft: { capability: so.token.nft.capability, commitment: toUint8Array(so.token.nft.commitment ?? '') } } : {}),
          },
        } : {}),
      }));
      for (const [inputIndex, pathName, addressIndex] of request.inputPaths) {
        const key = childKey(PATHS[pathName], BigInt(addressIndex));
        const pubkey = secp256k1.derivePublicKeyCompressed(key) as Uint8Array;
        // The key must own this coin; the protocol relies on SIGHASH_ALL making a wrong key harmless.
        const expectedLock = `76a914${binToHex(hash160(pubkey))}88ac`;
        if (binToHex(sourceOutputs[inputIndex].lockingBytecode) !== expectedLock) throw new Error(`input ${inputIndex} is not ours`);
        const serialization = generateSigningSerializationBCH(
          { inputIndex, sourceOutputs, transaction },
          { coveredBytecode: sourceOutputs[inputIndex].lockingBytecode, signingSerializationType: Uint8Array.of(SIGHASH_ALL_FORKID_UTXOS) },
        );
        const signature = secp256k1.signMessageHashSchnorr(key, sha256.hash(sha256.hash(serialization)));
        if (typeof signature === 'string') throw new Error(signature);
        transaction.inputs[inputIndex].unlockingBytecode = Uint8Array.from([
          ...encodeDataPush(Uint8Array.from([...signature, SIGHASH_ALL_FORKID_UTXOS])),
          ...encodeDataPush(pubkey),
        ]);
      }
      return { signedTransaction: binToHex(encodeTransaction(transaction)) };
    },
  };

  const manager = new WalletConnectionManager(adapter);
  manager.on('pendingSignRequest', async ({ connectionId, request }) => {
    try {
      const { signedTransaction } = await adapter.signTransaction(request);
      await manager.sendSignResponse(connectionId, request.sequence, signedTransaction);
    } catch (error) {
      await manager.sendSignError(connectionId, request.sequence, (error as Error).message);
    }
  });

  return {
    manager,
    signRequests,
    /** P2PKH locking bytecode of the address at path/index. */
    lockingBytecode: (path: 'receive' | 'change', index: number) => `76a914${binToHex(hash160(publicKey(PATHS[path], BigInt(index))))}88ac`,
  };
}
