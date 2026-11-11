import type { SignatureTemplate, WcTransactionObject } from 'cashscript';

/** One P2PKH address of the connected wallet. */
export interface WalletAddress {
  address: string;
  lockingBytecode: string;
  pkh: string;
  /** HD wallets (WizardConnect): where the address comes from, so the wallet knows which key signs. */
  path?: { name: string; index: number };
}

/** Which inputs the wallet must sign, and with the key of which address (by public key hash). */
export type InputSigners = Array<{ inputIndex: number; pkh: string }>;

/** A connected wallet. The app never sees the wallet's keys. */
export interface WalletSession {
  kind: 'walletconnect' | 'wizardconnect' | 'preview';
  /** Wallet name for display. */
  label: string;
  /** The wallet's main address: shown in the header; change goes here when no other fits. */
  address: string;
  lockingBytecode: string;
  pkh: string;
  /** Every address the app knows for this wallet. One for WalletConnect; many for HD wallets. */
  addresses: WalletAddress[];
  /** Preview only: a local test key that signs in the page. */
  localSigner?: SignatureTemplate;
  /** The wallet signs the listed inputs; the app broadcasts. */
  signTransaction?: (request: WcTransactionObject, signers: InputSigners) => Promise<{ signedTransaction: string }>;
  disconnect: () => Promise<void>;
}

export function addressForLockingBytecode(wallet: WalletSession, lockingBytecode: string): WalletAddress | undefined {
  return wallet.addresses.find((a) => a.lockingBytecode === lockingBytecode);
}
