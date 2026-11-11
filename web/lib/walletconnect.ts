// WalletConnect v2 with the BCH namespace (https://github.com/mainnet-pat/wc2-bch-bcr),
// tested target: Cashonize on chipnet.
import SignClient from '@walletconnect/sign-client';
import type { SessionTypes } from '@walletconnect/types';
import { binToHex, cashAddressToLockingBytecode, stringify } from '@bitauth/libauth';
import type { WalletSession } from './wallet';

const CHAIN_ID = 'bch:bchtest'; // chipnet ("bch:bitcoincash" on mainnet)
const NAMESPACES = {
  bch: { chains: [CHAIN_ID], methods: ['bch_getAddresses', 'bch_signTransaction', 'bch_signMessage'], events: ['addressesChanged'] },
};

let clientPromise: Promise<InstanceType<typeof SignClient>> | undefined;

export function walletConnectConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_WC_PROJECT_ID);
}

function client() {
  const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID;
  if (!projectId) throw new Error('This site has no WalletConnect project ID (NEXT_PUBLIC_WC_PROJECT_ID).');
  clientPromise ??= SignClient.init({
    projectId,
    metadata: {
      name: 'Backstop',
      description: 'A safety net for your ParyonUSD loan',
      url: window.location.origin,
      icons: [new URL('icon.svg', window.location.href).toString()],
    },
  });
  return clientPromise;
}

async function toSession(signClient: InstanceType<typeof SignClient>, session: SessionTypes.Struct): Promise<WalletSession> {
  const addresses = await signClient.request<string[]>({ chainId: CHAIN_ID, topic: session.topic, request: { method: 'bch_getAddresses', params: {} } });
  const address = addresses[0];
  const decoded = cashAddressToLockingBytecode(address);
  if (typeof decoded === 'string') throw new Error(`The wallet gave an address this app cannot read: ${decoded}`);
  const lockingBytecode = binToHex(decoded.bytecode);
  if (!/^76a914[0-9a-f]{40}88ac$/.test(lockingBytecode)) throw new Error('Please use a standard (P2PKH) wallet address.');
  return {
    kind: 'walletconnect',
    label: session.peer.metadata.name || 'Your wallet',
    address,
    lockingBytecode,
    pkh: lockingBytecode.slice(6, 46),
    signTransaction: async (request) => signClient.request({
      chainId: CHAIN_ID,
      topic: session.topic,
      // Uint8Arrays and bigints travel in libauth's stringify format, as the spec requires.
      request: { method: 'bch_signTransaction', params: JSON.parse(stringify(request)) },
    }),
    disconnect: async () => { await signClient.disconnect({ topic: session.topic, reason: { code: 6000, message: 'User disconnected' } }); },
  };
}

/** Reconnects to a wallet approved earlier in this browser, if any. */
export async function restoreWalletConnect(): Promise<WalletSession | undefined> {
  if (!walletConnectConfigured()) return undefined;
  const signClient = await client();
  const session = signClient.session.getAll().find((s) => s.namespaces.bch?.accounts.some((a) => a.startsWith(CHAIN_ID)));
  return session ? toSession(signClient, session) : undefined;
}

/** Starts pairing. `onUri` receives the link to show as a QR code or open in the wallet. */
export async function connectWalletConnect(onUri: (uri: string) => void): Promise<WalletSession> {
  const signClient = await client();
  const { uri, approval } = await signClient.connect({ requiredNamespaces: NAMESPACES });
  if (uri) onUri(uri);
  return toSession(signClient, await approval());
}
