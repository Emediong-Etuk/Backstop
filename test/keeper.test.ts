// The keeper: stateless, keyless, and only ever able to send a correct rescue.
import { describe, expect, it } from 'vitest';
import { binToHex } from '@bitauth/libauth';
import { scanOnce, type Deployment } from '@backstop/keeper';
import { readRescueState } from '@backstop/contracts';
import { createWorld, DEFAULTS, demoOracle, dollars, keeper, MIGRATION_KEY_CATEGORY, movePrice, PARYON_TOKEN_ID, setUpVault } from './harness.js';

const deployment: Deployment = {
  network: 'mock', paryonTokenId: PARYON_TOKEN_ID, oraclePublicKey: binToHex(demoOracle.publicKey), migrationKeyCategory: MIGRATION_KEY_CATEGORY,
};

async function scenario() {
  const world = createWorld({ beforeSetup: true, priceCents: DEFAULTS.safePriceCents });
  const setupTxid = await setUpVault(world);
  const lines: string[] = [];
  const run = (dryRun: boolean) => scanOnce({
    provider: world.provider, deployment, setupTxids: [setupTxid], dryRun,
    keeperRewardSats: 2_000n, keeperLockingBytecode: keeper.lockingBytecode, log: (l) => lines.push(l),
  });
  return { world, setupTxid, lines, run };
}

describe('The keeper', () => {
  it('finds the vault from its setup transaction and leaves a safe loan alone', async () => {
    const { run, lines } = await scenario();
    const [result] = await run(false);
    expect(result.action).toBe('waiting');
    expect(lines.join('\n')).toMatch(/loan at 130\.43% at \$300\.00, rescue below \$287\.50/);
  });

  it('in dry-run mode prints the rescue it would send and broadcasts nothing', async () => {
    const { world, run, lines } = await scenario();
    await movePrice(world, DEFAULTS.crashPriceCents);
    const loanBefore = (await world.provider.getUtxosForLockingBytecode(world.contracts.loan.lockingBytecode))[0];

    const [result] = await run(true);
    expect(result.action).toBe('would-rescue');
    expect(lines.join('\n')).toMatch(/ratio\s+117\.39% -> 149\.9\d%/);
    expect(lines.join('\n')).toMatch(/raw transaction\s+[0-9a-f]+/);
    const loanAfter = (await world.provider.getUtxosForLockingBytecode(world.contracts.loan.lockingBytecode))[0];
    expect(loanAfter).toEqual(loanBefore);
  });

  it('rescues the loan when the price falls below the trigger, paying its fee from the reserve', async () => {
    const { world, run } = await scenario();
    await movePrice(world, DEFAULTS.crashPriceCents);
    const [result] = await run(false);
    expect(result.action).toBe('rescued');
    if (result.action !== 'rescued') return;

    const loan = (await world.provider.getUtxosForLockingBytecode(world.contracts.loan.lockingBytecode)).find((u) => u.txid === result.txid);
    expect(loan?.satoshis).toBe(DEFAULTS.collateralSats + result.topUpSats);
    // Fee at 1 sat/byte, and fee + reward within the vault's overhead limit.
    expect(result.minerFeeSats).toBeGreaterThanOrEqual(BigInt(result.hex.length / 2));
    expect(result.minerFeeSats + result.keeperRewardSats).toBeLessThanOrEqual(world.params.maxOverheadSats);
  });

  it('does not rescue the same loan twice at the same price', async () => {
    const { world, run } = await scenario();
    await movePrice(world, DEFAULTS.crashPriceCents);
    expect((await run(false))[0].action).toBe('rescued');
    const [second] = await run(false);
    expect(second.action).toBe('waiting');
  });

  it('rescues again after a further fall, from the new collateral level', async () => {
    const { world, run } = await scenario();
    await movePrice(world, DEFAULTS.crashPriceCents);
    expect((await run(false))[0].action).toBe('rescued');
    await movePrice(world, dollars(220)); // 150% at $270 becomes about 122% at $220
    const [again] = await run(false);
    expect(again.action).toBe('rescued');
  });

  it('reports a withdrawn vault instead of failing', async () => {
    const { world, run } = await scenario();
    await movePrice(world, DEFAULTS.crashPriceCents);
    const { withdrawParts } = await import('@backstop/contracts');
    const { owner } = await import('./harness.js');
    await world.build(withdrawParts({
      vault: world.vault, key: world.utxos.key, reserve: world.utxos.reserve,
      ownerSigner: owner.signer, minerFeeSats: 2_000n, toLockingBytecode: owner.lockingBytecode,
    })).send();
    const [result] = await run(false);
    expect(result).toMatchObject({ action: 'skipped', reason: expect.stringMatching(/no longer holds the loan key/) });
    expect(readRescueState(world.utxos).collateralSats).toBe(DEFAULTS.collateralSats);
  });
});
