import type { SignatureTemplate, WcTransactionObject } from 'cashscript';

/** A connected wallet. The app never sees the wallet's keys. */
export interface WalletSession {
  kind: 'walletconnect' | 'preview';
  /** Wallet name for display. */
  label: string;
  address: string;
  lockingBytecode: string;
  pkh: string;
  /** Preview only: a local test key that signs in the page. */
  localSigner?: SignatureTemplate;
  /** WalletConnect: the wallet signs; the app broadcasts. */
  signTransaction?: (request: WcTransactionObject) => Promise<{ signedTransaction: string; signedTransactionHash: string }>;
  disconnect: () => Promise<void>;
}
