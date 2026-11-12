// The network the app talks to: chipnet through Electrum (the real demo), or a local
// in-memory chain (preview mode, for trying the app without a wallet or network).
import { ElectrumNetworkProvider, Network, type NetworkProvider } from 'cashscript';
import { ElectrumClient } from '@electrum-cash/network';
import { ElectrumWebSocket } from '@electrum-cash/web-socket';
import { paryonContracts, type Deployment, type ParyonContracts } from '@backstop/contracts';

export interface Chain {
  kind: 'chipnet' | 'preview';
  provider: NetworkProvider;
  deployment: Deployment;
  paryon: ParyonContracts;
  explorerTx?: (txid: string) => string;
}

export class NoDeploymentError extends Error {}

/**
 * An Electrum connection that stays open while the tab is hidden. By default the browser
 * transport (@electrum-cash/web-socket) disconnects whenever the page is hidden, which is
 * exactly when the user is approving something in their wallet's tab: the app's next chain
 * lookup then fails with "Failed to connect to '<server>'".
 */
export function chipnetProvider(server = 'chipnet.bch.ninja'): ElectrumNetworkProvider {
  const socket = new ElectrumWebSocket(server, { enforceConsistentBrowserBehavior: false });
  const electrum = new ElectrumClient('Backstop', '1.5.0', socket);
  return new ElectrumNetworkProvider(Network.CHIPNET, { electrum });
}

export async function connectChipnet(): Promise<Chain> {
  const response = await fetch('deployment.json', { cache: 'no-store' }).catch(() => undefined);
  if (!response?.ok) throw new NoDeploymentError('No chipnet deployment is configured for this site yet.');
  const deployment = (await response.json()) as Deployment;
  const provider = chipnetProvider(process.env.NEXT_PUBLIC_ELECTRUM_SERVER);
  return {
    kind: 'chipnet', provider, deployment, paryon: paryonContracts(provider, deployment),
    explorerTx: (txid) => `https://chipnet.imaginary.cash/tx/${txid}`,
  };
}

export const isPreviewMode = () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('preview');
