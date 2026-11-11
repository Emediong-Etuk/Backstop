// LOCAL PREVIEW: a throwaway in-memory chain inside the page (mem-cash), with our demo deployment
// of Paryon's contracts, one demo loan and a test wallet. Nothing touches a real network. It lets
// anyone try the app (and lets us test it) without a wallet, chipnet coins or a WalletConnect ID.
import { binToHex, sha256, utf8ToBin } from '@bitauth/libauth';
import { findOwnedVaults, paryonContracts } from '@backstop/contracts';
import { scanOnce } from '@backstop/keeper/scan';
import { deployDemo, MemCashProvider, newWallet, publishDemoPrice } from '@backstop/demo';
import type { Chain } from './chain';
import type { WalletSession } from './wallet';

const BCH = 100_000_000n;

export interface PreviewControls {
  setPrice(priceCents: bigint): Promise<void>;
  mine(blocks?: number): Promise<void>;
  runKeeper(): Promise<string[]>;
}

export async function startPreview(): Promise<{ chain: Chain; wallet: WalletSession; controls: PreviewControls }> {
  const provider = new MemCashProvider();
  const [funder, oracle, borrower, keeper] = [newWallet(), newWallet(), newWallet(), newWallet()];
  const coin = (label: string) => binToHex(sha256.hash(utf8ToBin(`preview ${label} ${Math.random()}`)));
  provider.addUtxo(funder.lockingBytecode, { txid: coin('funder'), vout: 0, satoshis: 2n * BCH });
  provider.addUtxo(borrower.lockingBytecode, { txid: coin('borrower'), vout: 0, satoshis: 1n * BCH });

  // One demo loan: 0.5 BCH collateral, $115 borrowed, at $300 per BCH (130%).
  const deployment = await deployDemo({
    provider, funder, oracle, startPriceCents: 30_000n, log: () => {},
    loans: [{ collateralSats: BCH / 2n, debtCents: 11_500n, borrowerLockingBytecode: borrower.lockingBytecode }],
  });
  provider.mine();

  const chain: Chain = { kind: 'preview', provider, deployment, paryon: paryonContracts(provider, deployment) };
  const wallet: WalletSession = {
    kind: 'preview', label: 'Preview wallet', address: borrower.address, lockingBytecode: borrower.lockingBytecode, pkh: borrower.pkh,
    localSigner: borrower.signer, disconnect: async () => {},
  };
  const controls: PreviewControls = {
    async setPrice(priceCents) {
      await publishDemoPrice({ provider, deployment, oracle, funder, priceCents, log: () => {} });
      provider.mine();
    },
    async mine(blocks = 1) {
      provider.mine(blocks);
    },
    async runKeeper() {
      const vaults = await findOwnedVaults(provider, borrower.pkh, borrower.lockingBytecode);
      const lines: string[] = [];
      await scanOnce({
        provider, deployment, setupTxids: vaults.map((v) => v.setupTxid), dryRun: false,
        keeperRewardSats: 2_000n, keeperLockingBytecode: keeper.lockingBytecode, log: (l) => lines.push(l),
      });
      provider.mine();
      return lines.length ? lines : ['No vaults to check yet.'];
    },
  };
  return { chain, wallet, controls };
}
