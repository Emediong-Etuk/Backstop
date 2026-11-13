// Demo keys. Read from .env (never committed). Chipnet only.
import { SignatureTemplate, TransactionBuilder, type NetworkProvider, type SpendableUtxo } from 'cashscript';
import {
  binToHex, decodePrivateKeyWif, encodePrivateKeyWif, generatePrivateKey, hash160, lockingBytecodeToCashAddress, secp256k1,
} from '@bitauth/libauth';

export interface DemoWallet {
  wif: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  pkh: string;
  lockingBytecode: string;
  /** Plain chipnet address (bchtest:q...). */
  address: string;
  /** Token-aware chipnet address (bchtest:z...), where a wallet can receive tokens. */
  tokenAddress: string;
  signer: SignatureTemplate;
}

export function walletFromPrivateKey(privateKey: Uint8Array): DemoWallet {
  const publicKey = secp256k1.derivePublicKeyCompressed(privateKey) as Uint8Array;
  const pkh = binToHex(hash160(publicKey));
  const lockingBytecode = `76a914${pkh}88ac`;
  const address = (code: boolean) => {
    const result = lockingBytecodeToCashAddress({ bytecode: Uint8Array.from(Buffer.from(lockingBytecode, 'hex')), prefix: 'bchtest', tokenSupport: code });
    if (typeof result === 'string') throw new Error(result);
    return result.address;
  };
  return {
    wif: encodePrivateKeyWif(privateKey, 'testnet'),
    privateKey, publicKey, pkh, lockingBytecode,
    address: address(false), tokenAddress: address(true),
    signer: new SignatureTemplate(privateKey),
  };
}

export function walletFromWif(wif: string, name: string): DemoWallet {
  const decoded = decodePrivateKeyWif(wif);
  if (typeof decoded === 'string') throw new Error(`${name}: ${decoded}`);
  return walletFromPrivateKey(decoded.privateKey);
}

export function newWallet(): DemoWallet {
  return walletFromPrivateKey(generatePrivateKey());
}

/** Reads a WIF from the environment, with a clear message if it is missing. */
export function walletFromEnv(variable: 'DEMO_ORACLE_WIF' | 'DEMO_FUNDER_WIF' | 'DEMO_BORROWER_WIF'): DemoWallet {
  const wif = process.env[variable];
  if (!wif) throw new Error(`${variable} is not set. Run "npm run demo:keys -- --write" to create demo keys in .env.`);
  return walletFromWif(wif, variable);
}

/** BCH-only coins of a wallet, largest first. */
export async function bchCoins(provider: NetworkProvider, wallet: DemoWallet): Promise<SpendableUtxo[]> {
  return (await provider.getUtxosForLockingBytecode(wallet.lockingBytecode))
    .filter((u) => !u.token)
    .sort((a, b) => (a.satoshis < b.satoshis ? 1 : -1));
}

/** Picks coins covering `sats`, largest first. */
export async function pickCoins(provider: NetworkProvider, wallet: DemoWallet, sats: bigint, label: string): Promise<SpendableUtxo[]> {
  const picked: SpendableUtxo[] = [];
  let total = 0n;
  for (const coin of await bchCoins(provider, wallet)) {
    if (total >= sats) break;
    picked.push(coin);
    total += coin.satoshis;
  }
  if (total < sats) {
    throw new Error(`${label} wallet ${wallet.address} has ${total} sats, needs ${sats}. Send it chipnet BCH from a faucet on the same chain as your server ("npm run demo:servers" checks the servers)`);
  }
  return picked;
}

/**
 * Sends BCH from a demo wallet to any address, change back to the wallet. For moving the
 * funder's spare test BCH to the borrower's own wallet when a faucet is short.
 */
export async function sendBch(args: { provider: NetworkProvider; from: DemoWallet; to: string; sats: bigint; feeRate?: number }): Promise<string> {
  const { provider, from, to, sats, feeRate = 1.0 } = args;
  const coins = await pickCoins(provider, from, sats + 2_000n, 'Funder');
  const builder = new TransactionBuilder({ provider });
  for (const coin of coins) builder.addInput(coin, from.signer.unlockP2PKH());
  builder.addOutput({ to, amount: sats });
  builder.addBchChangeOutputIfNeeded({ to: from.address, feeRate });
  return (await builder.send()).txid;
}
