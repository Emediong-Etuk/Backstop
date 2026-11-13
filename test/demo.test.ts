// The demo scripts end to end on the mem-cash node: the same functions the demo CLI calls on chipnet.
import { describe, expect, it } from 'vitest';
import { binToHex, sha256, utf8ToBin } from '@bitauth/libauth';
import { OracleData } from '@generalprotocols/price-oracle';
import { scanOnce } from '@backstop/keeper';
import { paryonContracts, parseLoanState } from '@backstop/contracts';
import {
  deployDemo, DEMO_NO_MIGRATION_KEY, nextHeartbeatSequence, publishDemoPrice, sendBch, setUpDemoVault, signDemoPrice, vaultStatus, walletFromPrivateKey, withdrawDemoVault,
} from '@backstop/demo';
import { MemCashProvider } from '@backstop/demo';

const BCH = 100_000_000n;
const wallet = (label: string) => walletFromPrivateKey(sha256.hash(utf8ToBin(`backstop demo test: ${label}`)));
const oracle = wallet('oracle');
const funder = wallet('funder');
const borrower = wallet('borrower');

async function freshChain() {
  const provider = new MemCashProvider();
  let n = 0;
  const fund = (w: typeof funder, sats: bigint) => provider.addUtxo(w.lockingBytecode, { txid: binToHex(sha256.hash(utf8ToBin(`coin ${w.pkh} ${++n}`))), vout: 0, satoshis: sats });
  fund(funder, 2n * BCH);
  fund(borrower, 1n * BCH);
  return provider;
}

describe('Demo oracle', () => {
  it('signs messages in the General Protocols format that the oracle library itself parses and verifies', async () => {
    const signed = await signDemoPrice(oracle, { priceCents: 25_000n, dataSequence: 1_010n, timestamp: 1_794_000_000 });
    expect(signed.message).toHaveLength(16);
    expect(await OracleData.parsePriceMessage(signed.message)).toEqual({ messageTimestamp: 1_794_000_000, messageSequence: 1_010, priceSequence: 1_010, priceValue: 25_000 });
    expect(await OracleData.verifyMessageSignature(signed.message, signed.signature, oracle.publicKey)).toBe(true);
  });

  it('always moves to the next heartbeat sequence, which the price contract accepts', () => {
    expect(nextHeartbeatSequence(1_000n)).toBe(1_010n);
    expect(nextHeartbeatSequence(1_007n)).toBe(1_010n);
  });
});

describe('The demo on a BCHN-like node', () => {
  it('deploys, sets up a vault, crashes the price, the keeper rescues, and the borrower withdraws', async () => {
    const provider = await freshChain();
    const log = () => {};

    // Deploy Paryon's add-collateral contracts with two demo loans of 0.5 BCH and $115 debt at $300.
    const deployment = await deployDemo({
      provider, funder, oracle, startPriceCents: 30_000n, log,
      loans: [0, 1].map(() => ({ collateralSats: BCH / 2n, debtCents: 11_500n, borrowerLockingBytecode: borrower.lockingBytecode })),
    });
    expect(deployment.migrationKeyCategory).toBe(DEMO_NO_MIGRATION_KEY);
    expect(deployment.demo.loans).toHaveLength(2);
    provider.mine();

    // The deployed contracts are Paryon's, at their usual addresses.
    const paryon = paryonContracts(provider, deployment);
    const loans = await provider.getUtxosForLockingBytecode(paryon.loan.lockingBytecode);
    expect(loans).toHaveLength(2);
    expect(parseLoanState(loans[0].token!.nft!.commitment).debtCents).toBe(11_500n);

    // The borrower sets up a vault for loan 0 with a 0.3 BCH reserve and a 1-block cooldown.
    const { setupTxid } = await setUpDemoVault({
      provider, deployment, borrower, loanKeyCategory: deployment.demo.loans[0].loanKeyCategory, reserveSats: 3n * BCH / 10n, cooldownBlocks: 1n,
    });
    provider.mine();
    const before = await vaultStatus({ provider, deployment, setupTxid });
    expect(before).toMatchObject({ ratioBps: 13_043n, priceCents: 30_000n });

    const keep = () => scanOnce({ provider, deployment, setupTxids: [setupTxid], dryRun: false, log });
    expect((await keep())[0].action).toBe('waiting');

    // The DEMO oracle reports $265: the loan falls to 115%.
    await publishDemoPrice({ provider, deployment, oracle, funder, priceCents: 26_500n, log });
    provider.mine();
    const crashed = await vaultStatus({ provider, deployment, setupTxid });
    expect(crashed).toMatchObject({ ratioBps: 11_521n });

    const [rescue] = await keep();
    expect(rescue.action).toBe('rescued');
    provider.mine();
    const after = await vaultStatus({ provider, deployment, setupTxid });
    if ('empty' in after) throw new Error(after.empty);
    // Reaching 150% needs 0.1509 BCH; the per-rescue limit (half the reserve) is 0.15 BCH,
    // so the rescue uses the whole limit and the loan lands just under the target.
    expect(after.collateralSats).toBe(BCH / 2n + 15_000_000n);
    expect(after.ratioBps).toBe(14_978n);

    // The borrower takes the key and what is left of the reserve.
    await withdrawDemoVault({ provider, borrower, setupTxid });
    const key = (await provider.getUtxosForLockingBytecode(borrower.lockingBytecode)).find((u) => u.token?.category === deployment.demo.loans[0].loanKeyCategory);
    expect(key?.token?.nft?.capability).toBe('minting');
    expect(await vaultStatus({ provider, deployment, setupTxid })).toMatchObject({ empty: expect.stringMatching(/no longer holds the loan key/) });
  });

  // For when a faucet gives little: Paryon's minimum debt is in dollars ($100), so a higher
  // demo price shrinks every BCH amount while the ratios, and the story, stay the same.
  // The second case is a funder and wallet holding only what one 1,000,000-sat faucet request gives.
  it.each([
    { label: 'a tenth of the BCH at $3,000', priceCents: 300_000n, sats: 5_000_000n, funderSats: 7_000_000n, borrowerSats: 6_000_000n },
    { label: 'a hundredth of the BCH at $30,000', priceCents: 3_000_000n, sats: 500_000n, funderSats: 1_017_000n, borrowerSats: 1_000_000n },
  ])('runs on $label (one loan and a reserve of the same size)', async ({ priceCents, sats, funderSats, borrowerSats }) => {
    const provider = new MemCashProvider();
    let n = 0;
    const fund = (w: typeof funder, sats: bigint) => provider.addUtxo(w.lockingBytecode, { txid: binToHex(sha256.hash(utf8ToBin(`small ${w.pkh} ${++n}`))), vout: 0, satoshis: sats });
    fund(funder, funderSats);
    fund(borrower, borrowerSats);
    const log = () => {};

    const deployment = await deployDemo({
      provider, funder, oracle, startPriceCents: priceCents, log,
      loans: [{ collateralSats: sats, debtCents: 11_500n, borrowerLockingBytecode: borrower.lockingBytecode }],
    });
    provider.mine();
    const { setupTxid } = await setUpDemoVault({
      provider, deployment, borrower, loanKeyCategory: deployment.demo.loans[0].loanKeyCategory, reserveSats: sats, cooldownBlocks: 1n,
    });
    provider.mine();
    expect(await vaultStatus({ provider, deployment, setupTxid })).toMatchObject({ ratioBps: 13_043n });

    await publishDemoPrice({ provider, deployment, oracle, funder, priceCents: priceCents * 265n / 300n, log });
    provider.mine();
    const [rescue] = await scanOnce({ provider, deployment, setupTxids: [setupTxid], dryRun: false, log });
    expect(rescue.action).toBe('rescued');
    provider.mine();
    const after = await vaultStatus({ provider, deployment, setupTxid });
    if ('empty' in after) throw new Error(after.empty);
    expect(after.ratioBps).toBeGreaterThan(14_900n);
    expect(after.ratioBps).toBeLessThanOrEqual(15_000n);

    await withdrawDemoVault({ provider, borrower, setupTxid });
  });

  it('runs when only the funder got faucet coins: it pays the wallet 0.004 BCH and still pays for the price crash', async () => {
    // The chipnet run of 12 November 2026: the funder had 1,017,000 sats on the real chain and
    // the borrower's wallet none, because the other faucet payments went to a server on its own branch.
    const provider = new MemCashProvider();
    provider.addUtxo(funder.lockingBytecode, { txid: binToHex(sha256.hash(utf8ToBin('one faucet request'))), vout: 0, satoshis: 1_017_000n });
    const log = () => {};
    const deployment = await deployDemo({
      provider, funder, oracle, startPriceCents: 3_000_000n, log,
      loans: [{ collateralSats: 500_000n, debtCents: 11_500n, borrowerLockingBytecode: borrower.lockingBytecode }],
    });
    provider.mine();

    await sendBch({ provider, from: funder, to: borrower.tokenAddress, sats: 400_000n });
    provider.mine();
    const { setupTxid } = await setUpDemoVault({
      provider, deployment, borrower, loanKeyCategory: deployment.demo.loans[0].loanKeyCategory, reserveSats: 300_000n, cooldownBlocks: 1n,
    });
    provider.mine();

    await publishDemoPrice({ provider, deployment, oracle, funder, priceCents: 2_650_000n, log });
    provider.mine();
    const [rescue] = await scanOnce({ provider, deployment, setupTxids: [setupTxid], dryRun: false, log });
    expect(rescue.action).toBe('rescued');
    provider.mine();
    const after = await vaultStatus({ provider, deployment, setupTxid });
    if ('empty' in after) throw new Error(after.empty);
    // Half the reserve (0.0015 BCH) is the per-rescue limit; it lifts the loan to just under 150%.
    expect(after.ratioBps).toBeGreaterThan(14_500n);
    expect(after.ratioBps).toBeLessThanOrEqual(15_000n);

    // The demo can still put the price back up afterwards.
    await publishDemoPrice({ provider, deployment, oracle, funder, priceCents: 3_000_000n, log });
    await withdrawDemoVault({ provider, borrower, setupTxid });
  });
});
