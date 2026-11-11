// The network the app talks to: chipnet through Electrum (the real demo), or a local
// in-memory chain (preview mode, for trying the app without a wallet or network).
import { ElectrumNetworkProvider, Network, type NetworkProvider } from 'cashscript';
import { paryonContracts, type Deployment, type ParyonContracts } from '@backstop/contracts';

export interface Chain {
  kind: 'chipnet' | 'preview';
  provider: NetworkProvider;
  deployment: Deployment;
  paryon: ParyonContracts;
  explorerTx?: (txid: string) => string;
}

export class NoDeploymentError extends Error {}

export async function connectChipnet(): Promise<Chain> {
  const response = await fetch('deployment.json', { cache: 'no-store' }).catch(() => undefined);
  if (!response?.ok) throw new NoDeploymentError('No chipnet deployment is configured for this site yet.');
  const deployment = (await response.json()) as Deployment;
  const server = process.env.NEXT_PUBLIC_ELECTRUM_SERVER;
  const provider = new ElectrumNetworkProvider(Network.CHIPNET, server ? { hostname: server } : {});
  return {
    kind: 'chipnet', provider, deployment, paryon: paryonContracts(provider, deployment),
    explorerTx: (txid) => `https://chipnet.imaginary.cash/tx/${txid}`,
  };
}

export const isPreviewMode = () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('preview');
