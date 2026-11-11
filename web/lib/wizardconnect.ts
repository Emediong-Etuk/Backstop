// WizardConnect (https://gitlab.com/riftenlabs/lib/wizardconnect), protocol hdwalletv1.
// The wallet shares xpubs for its receive and change paths; the app derives the addresses itself
// and asks the wallet to sign specific inputs with specific keys (inputPaths).
//
// WizardConnect wallets sign only their own (P2PKH) coins. Contract inputs travel with their
// unlocking bytecode already set. That is why withdraw uses Backstop's ownerWithdraw, where the
// owner proves ownership by spending one of their own coins (see contracts/Backstop.cash).
import type { NetworkProvider, WcTransactionObject } from 'cashscript';
import { binToHex, encodeTransaction, hash160, hexToBin, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { childIndexOfPathName, initiateDappRelay, PATH_CHANGE, PATH_RECEIVE, type DappRelayResult } from '@wizardconnect/core';
import { sourceOutputToRelay } from '@wizardconnect/core/hdwalletv1-serialize';
import { DappConnectionManager, loadSession, type SessionStorage } from '@wizardconnect/dapp';
import { history } from '@backstop/contracts';
import type { InputSigners, WalletAddress, WalletSession } from './wallet';

export interface WizardConnectOptions {
  /** Nostr relays; WizardConnect's defaults when omitted. */
  relayUrls?: string[];
  /** Where to keep the session between page loads; false to keep nothing (tests). */
  storage?: SessionStorage | false;
  /** CashAddress prefix: 'bchtest' for chipnet. */
  prefix?: 'bitcoincash' | 'bchtest' | 'bchreg';
  /** Stop scanning a path after this many unused addresses in a row. */
  gapLimit?: number;
  dappIcon?: string;
}

const SCANNED_PATHS = [PATH_RECEIVE, PATH_CHANGE];
const SESSION_KEY = 'backstop-wizardconnect';

function sessionOptions(options: WizardConnectOptions) {
  return options.storage === false ? false : { key: SESSION_KEY, ...(options.storage ? { storage: options.storage } : {}) };
}

function addressFromPubkey(pubkey: Uint8Array, prefix: NonNullable<WizardConnectOptions['prefix']>, path: { name: string; index: number }): WalletAddress {
  const pkh = binToHex(hash160(pubkey));
  const lockingBytecode = `76a914${pkh}88ac`;
  const encoded = lockingBytecodeToCashAddress({ bytecode: hexToBin(lockingBytecode), prefix, tokenSupport: true });
  if (typeof encoded === 'string') throw new Error(encoded);
  return { address: encoded.address, lockingBytecode, pkh, path };
}

/**
 * Finds the wallet's addresses that have been used, from chain history, plus the first unused
 * receive address. Stops after `gapLimit` unused addresses in a row on each path.
 */
async function scanAddresses(manager: DappConnectionManager, provider: NetworkProvider, options: WizardConnectOptions): Promise<WalletAddress[]> {
  const prefix = options.prefix ?? 'bchtest';
  const gapLimit = options.gapLimit ?? 10;
  const found: WalletAddress[] = [];
  for (const name of SCANNED_PATHS) {
    const childIndex = childIndexOfPathName(name);
    if (childIndex === undefined || !manager.hasPath(childIndex)) continue;
    let unused = 0;
    for (let index = 0; unused < gapLimit && index < 1_000; index++) {
      const pubkey = manager.getPubkey(childIndex, BigInt(index));
      if (!pubkey) break;
      const address = addressFromPubkey(pubkey, prefix, { name, index });
      // Used = has any history or any unspent coin.
      const used = (await history(provider, address.lockingBytecode)).length > 0
        || (await provider.getUtxosForLockingBytecode(address.lockingBytecode)).length > 0;
      if (used) {
        found.push(address);
        unused = 0;
      } else {
        if (name === PATH_RECEIVE && !found.some((a) => a.path?.name === PATH_RECEIVE)) found.push(address);
        unused++;
      }
    }
  }
  return found;
}

function toSession(manager: DappConnectionManager, relay: DappRelayResult, addresses: WalletAddress[]): WalletSession {
  const primary = addresses.find((a) => a.path?.name === PATH_RECEIVE) ?? addresses[0];
  if (!primary) throw new Error('The wallet did not share a receive path.');
  return {
    kind: 'wizardconnect',
    label: manager.walletName || 'Your wallet',
    address: primary.address,
    lockingBytecode: primary.lockingBytecode,
    pkh: primary.pkh,
    addresses,
    signTransaction: (request, signers) => signWithWizardConnect(manager, addresses, request, signers),
    disconnect: async () => {
      manager.clearStoredSession();
      await manager.sendDisconnect('Disconnected from Backstop').catch(() => undefined);
      relay.cleanup();
      manager.destroy();
    },
  };
}

async function signWithWizardConnect(manager: DappConnectionManager, addresses: WalletAddress[], request: WcTransactionObject, signers: InputSigners) {
  const inputPaths = signers.map(({ inputIndex, pkh }): [number, string, number] => {
    const address = addresses.find((a) => a.pkh === pkh);
    if (!address?.path) throw new Error('This wallet does not hold the key for one of the coins in this transaction.');
    return [inputIndex, address.path.name, address.path.index];
  });
  const transaction = typeof request.transaction === 'string' ? request.transaction : binToHex(encodeTransaction(request.transaction));
  const response = await manager.signTransaction({
    transaction: {
      transaction,
      // Relay JSON: hex for bytes, "<bigint: …n>" for amounts (WizardConnect's serializer).
      sourceOutputs: request.sourceOutputs.map((output) => sourceOutputToRelay({
        ...output,
        token: output.token && {
          category: output.token.category,
          amount: output.token.amount,
          nft: output.token.nft && { capability: output.token.nft.capability, commitment: output.token.nft.commitment },
        },
      })),
      broadcast: request.broadcast ?? false,
      userPrompt: request.userPrompt,
    } as never,
    inputPaths,
  });
  if (response.error) throw new Error(`The wallet did not sign: ${response.error}`);
  return { signedTransaction: response.signedTransaction };
}

/** Starts pairing. `onUri` receives the wiz:// link to show as a QR code. Resolves once the wallet has connected. */
export async function connectWizardConnect(onUri: (uri: string) => void, provider: NetworkProvider, options: WizardConnectOptions = {}): Promise<WalletSession> {
  const manager = new DappConnectionManager('Backstop', options.dappIcon, { session: sessionOptions(options) });
  manager.clearStoredSession();
  const relay = initiateDappRelay((payload) => manager.updateConnection(payload.client, payload.status), options.relayUrls ? { explicitRelayUrls: options.relayUrls } : undefined);
  if (options.storage !== false) manager.attachRelay(relay);
  const ready = new Promise<void>((resolve) => manager.once('walletready', () => resolve()));
  onUri(relay.uri);
  await ready;
  return toSession(manager, relay, await scanAddresses(manager, provider, options));
}

/** Reconnects to a wallet paired earlier in this browser, if any. */
export async function restoreWizardConnect(provider: NetworkProvider, options: WizardConnectOptions = {}): Promise<WalletSession | undefined> {
  if (options.storage === false) return undefined;
  const stored = loadSession(SESSION_KEY, options.storage || undefined);
  if (!stored?.walletPublicKey || !stored.paths?.length) return undefined;
  const manager = new DappConnectionManager('Backstop', options.dappIcon, { session: sessionOptions(options) });
  const relay = initiateDappRelay((payload) => manager.updateConnection(payload.client, payload.status), {
    ...(options.relayUrls ? { explicitRelayUrls: options.relayUrls } : {}),
    existingCredentials: { privateKey: stored.privateKey, secret: stored.secret, walletPublicKey: stored.walletPublicKey },
  });
  manager.attachRelay(relay);
  return toSession(manager, relay, await scanAddresses(manager, provider, options));
}
