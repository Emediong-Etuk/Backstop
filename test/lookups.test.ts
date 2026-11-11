// What the web app reads from the chain: the wallet's loans, its vaults and their history.
// Built on the demo deployment so every UTXO comes from a real transaction, as on chipnet.
import { describe, expect, it } from 'vitest';
import { binToHex, sha256, utf8ToBin } from '@bitauth/libauth';
import { findOwnedVaults, findWalletLoans, paryonContracts, vaultHistory } from '@backstop/contracts';
import { scanOnce } from '@backstop/keeper';
import { deployDemo, MemCashProvider, publishDemoPrice, setUpDemoVault, walletFromPrivateKey } from '@backstop/demo';

const BCH = 100_000_000n;
const wallet = (label: string) => walletFromPrivateKey(sha256.hash(utf8ToBin(`backstop lookups test: ${label}`)));
const [oracle, funder, borrower, keeper] = ['oracle', 'funder', 'borrower', 'keeper'].map(wallet);

describe("Reading a borrower's position from the chain", () => {
  it('finds the loan whose key is in the wallet, then the vault and its rescue history once it is set up', async () => {
    const provider = new MemCashProvider();
    provider.addUtxo(funder.lockingBytecode, { txid: binToHex(sha256.hash(utf8ToBin('f'))), vout: 0, satoshis: 2n * BCH });
    provider.addUtxo(borrower.lockingBytecode, { txid: binToHex(sha256.hash(utf8ToBin('b'))), vout: 0, satoshis: 1n * BCH });
    const log = () => {};
    const deployment = await deployDemo({
      provider, funder, oracle, startPriceCents: 30_000n, log,
      loans: [{ collateralSats: BCH / 2n, debtCents: 11_500n, borrowerLockingBytecode: borrower.lockingBytecode }],
    });
    provider.mine();
    const paryon = paryonContracts(provider, deployment);

    const loans = await findWalletLoans(provider, paryon, deployment, borrower.lockingBytecode);
    expect(loans.map((l) => l.loanKeyCategory)).toEqual([deployment.demo.loans[0].loanKeyCategory]);
    expect(await findOwnedVaults(provider, borrower.pkh, borrower.lockingBytecode)).toEqual([]);

    const { setupTxid } = await setUpDemoVault({ provider, deployment, borrower, loanKeyCategory: loans[0].loanKeyCategory, reserveSats: 3n * BCH / 10n, cooldownBlocks: 1n });
    provider.mine();
    expect(await findWalletLoans(provider, paryon, deployment, borrower.lockingBytecode)).toEqual([]); // the key is in the vault now
    const [vault] = await findOwnedVaults(provider, borrower.pkh, borrower.lockingBytecode);
    expect(vault.setupTxid).toBe(setupTxid);

    await publishDemoPrice({ provider, deployment, oracle, funder, priceCents: 26_500n, log });
    provider.mine();
    const [rescue] = await scanOnce({ provider, deployment, setupTxids: [setupTxid], dryRun: false, keeperRewardSats: 2_000n, keeperLockingBytecode: keeper.lockingBytecode, log });
    if (rescue.action !== 'rescued') throw new Error(`expected a rescue, got ${JSON.stringify(rescue)}`);
    provider.mine();

    const events = await vaultHistory(provider, vault);
    expect(events.map((e) => e.kind)).toEqual(['setup', 'rescue']);
    expect(events[1]).toMatchObject({ kind: 'rescue', topUpSats: rescue.topUpSats, overheadSats: rescue.minerFeeSats + rescue.keeperRewardSats });
  });
});
