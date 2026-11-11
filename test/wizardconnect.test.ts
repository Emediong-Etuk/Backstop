// WizardConnect end to end: the web app's own WizardConnect and action code, talking to
// @wizardconnect/wallet's real WalletConnectionManager through a local Nostr relay, on the
// mem-cash node. The wallet is an HD wallet whose coins sit at several addresses.
import { afterEach, describe, expect, it } from 'vitest';
import { binToHex, sha256, utf8ToBin } from '@bitauth/libauth';
import { paryonContracts } from '@backstop/contracts';
import { scanOnce } from '@backstop/keeper';
import { deployDemo, MemCashProvider, publishDemoPrice, walletFromPrivateKey } from '@backstop/demo';
import { connectWizardConnect } from '../web/lib/wizardconnect';
import { protectLoan, readPosition, withdrawEverything } from '../web/lib/actions';
import type { Chain } from '../web/lib/chain';
import type { WalletSession } from '../web/lib/wallet';
import { startNostrRelay } from './fixtures/nostr-relay.js';
import { startWizardWallet } from './fixtures/wizard-wallet.js';

const BCH = 100_000_000n;
const helper = (label: string) => walletFromPrivateKey(sha256.hash(utf8ToBin(`backstop wizardconnect test: ${label}`)));
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function setUp() {
  const relay = await startNostrRelay();
  cleanups.push(() => relay.close());
  const wallet = startWizardWallet('borrower');

  const provider = new MemCashProvider();
  const [funder, oracle, keeper] = ['funder', 'oracle', 'keeper'].map(helper);
  let n = 0;
  const coin = (lockingBytecode: string, satoshis: bigint) => provider.addUtxo(lockingBytecode, { txid: binToHex(sha256.hash(utf8ToBin(`coin ${++n}`))), vout: 0, satoshis });
  coin(funder.lockingBytecode, 2n * BCH);
  // The HD wallet's BCH sits at two addresses other than the one that will receive the loan key.
  coin(wallet.lockingBytecode('receive', 1), 25_000_000n);
  coin(wallet.lockingBytecode('change', 0), 15_000_000n);

  // The demo loan's key goes to the wallet's first receive address.
  const deployment = await deployDemo({
    provider, funder, oracle, startPriceCents: 30_000n, log: () => {},
    loans: [{ collateralSats: BCH / 2n, debtCents: 11_500n, borrowerLockingBytecode: wallet.lockingBytecode('receive', 0) }],
  });
  provider.mine();
  const chain: Chain = { kind: 'chipnet', provider, deployment, paryon: paryonContracts(provider, deployment) };

  const session: WalletSession = await connectWizardConnect((uri) => wallet.manager.connect(uri), provider, {
    relayUrls: [relay.url], storage: false, prefix: 'bchtest',
  });
  cleanups.push(() => session.disconnect());
  // Teardown runs in reverse: the wallet closes first, so it is not mid-reconnect when it closes.
  cleanups.push(() => wallet.manager.disconnectAll());
  return { relay, wallet, provider, chain, session, deployment, oracle, funder, keeper };
}

describe('WizardConnect', () => {
  it('pairs over a relay and finds the HD wallet\'s used addresses from its xpubs', async () => {
    const { wallet, session } = await setUp();
    expect(session.kind).toBe('wizardconnect');
    const found = session.addresses.map((a) => `${a.path?.name}/${a.path?.index}`);
    expect(found).toEqual(expect.arrayContaining(['receive/0', 'receive/1', 'change/0']));
    expect(session.addresses.find((a) => a.path?.name === 'receive' && a.path.index === 0)?.lockingBytecode).toBe(wallet.lockingBytecode('receive', 0));
  });

  it('protects a loan with one wallet signature, a keeper rescues it, and the owner withdraws with one signature', async () => {
    const { wallet, provider, chain, session, deployment, oracle, funder, keeper } = await setUp();

    // The app finds the loan whose key is at receive/0.
    const before = await readPosition(chain, session);
    expect(before.loans).toHaveLength(1);
    expect(before.walletBchSats).toBe(40_000_000n);

    // Setup: the wallet signs the loan key and coins from two other addresses, in one request.
    await protectLoan(chain, session, before.loans[0], {
      reserveSats: 30_000_000n, triggerRatioBps: 12_500n, targetRatioBps: 15_000n,
      maxTopUpSats: 15_000_000n, maxOverheadSats: 10_000n, cooldownBlocks: 1n,
    });
    expect(wallet.signRequests).toHaveLength(1);
    provider.mine();
    const protectedPosition = await readPosition(chain, session);
    const view = protectedPosition.vaults.find((v) => v.active);
    expect(view?.vault.params.ownerPkh).toBe(wallet.lockingBytecode('receive', 0).slice(6, 46));

    // The price falls and a keeper rescues the loan: no wallet involved.
    await publishDemoPrice({ provider, deployment, oracle, funder, priceCents: 26_500n, log: () => {} });
    provider.mine();
    const [rescue] = await scanOnce({ provider, deployment, setupTxids: [view!.vault.setupTxid], dryRun: false, keeperRewardSats: 2_000n, keeperLockingBytecode: keeper.lockingBytecode, log: () => {} });
    expect(rescue.action).toBe('rescued');
    provider.mine();
    expect(wallet.signRequests).toHaveLength(1);

    // Withdraw: the wallet signs only its own coin at receive/0 (ownerWithdraw); no contract signature.
    const rescued = await readPosition(chain, session);
    await withdrawEverything(chain, session, rescued.vaults.find((v) => v.active)!);
    expect(wallet.signRequests).toHaveLength(2);
    provider.mine();
    const after = await readPosition(chain, session);
    expect(after.vaults.some((v) => v.active)).toBe(false);
    expect(after.loans).toHaveLength(1); // the key is back in the wallet
    expect(after.loans[0].source.loanKey.lockingBytecode).toBe(wallet.lockingBytecode('receive', 0));
  });
});
