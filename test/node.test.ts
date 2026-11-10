// The same transactions on @paryonusd/mem-cash, an in-memory node that checks transactions the
// way BCHN does: relative timelocks (BIP68), standardness, dust and fee rules. Here the keeper
// talks to the chain through the same Electrum calls it makes on chipnet.
import { describe, expect, it } from 'vitest';
import { binToHex } from '@bitauth/libauth';
import { scanOnce, type Deployment } from '@backstop/keeper';
import { createWorld, DEFAULTS, demoOracle, keeper, MIGRATION_KEY_CATEGORY, movePrice, PARYON_TOKEN_ID, setUpVault } from './harness.js';
import { MemCashProvider } from './memcash.js';

const deployment: Deployment = {
  network: 'mock', paryonTokenId: PARYON_TOKEN_ID, oraclePublicKey: binToHex(demoOracle.publicKey), migrationKeyCategory: MIGRATION_KEY_CATEGORY,
};

async function onNode() {
  const provider = new MemCashProvider();
  const world = createWorld({ provider, beforeSetup: true, priceCents: DEFAULTS.safePriceCents });
  const setupTxid = await setUpVault(world);
  provider.mine(); // the setup confirms: the reserve is now 1 block old
  await movePrice(world, DEFAULTS.crashPriceCents);
  provider.mine();
  const lines: string[] = [];
  const keep = (dryRun = false) => scanOnce({
    provider, deployment, setupTxids: [setupTxid], dryRun,
    keeperRewardSats: 2_000n, keeperLockingBytecode: keeper.lockingBytecode, log: (l) => lines.push(l),
  });
  return { provider, world, keep, lines };
}

describe('On a BCHN-like node', () => {
  it('setup, price update and rescue are all standard transactions the node relays', async () => {
    const { provider, world, keep } = await onNode();
    provider.mine(Number(world.params.cooldownBlocks));
    const [result] = await keep();
    expect(result.action).toBe('rescued');
  });

  it('the node refuses a rescue until the reserve is as old as the cooldown (BIP68)', async () => {
    const { provider, world } = await onNode();
    // Reserve is 2 blocks old; the cooldown is 6. The transaction is correct but not yet final.
    await expect(world.build(world.rescue()).send()).rejects.toThrow(/non-BIP68-final|bad-txns-nonfinal|non-final/i);
    provider.mine(4);
    await expect(world.build(world.rescue()).send()).resolves.toBeDefined();
  });

  it('the keeper reads the reserve age over Electrum and waits out the cooldown instead of broadcasting early', async () => {
    const { provider, keep } = await onNode();
    const [early] = await keep();
    expect(early).toMatchObject({ action: 'waiting', reason: expect.stringMatching(/cooldown \(2\/6 blocks\)/) });
    provider.mine(4);
    const [later] = await keep();
    expect(later.action).toBe('rescued');
  });

  it('a dry run works against the node and leaves it unchanged', async () => {
    const { provider, keep, lines } = await onNode();
    provider.mine(6);
    const [result] = await keep(true);
    expect(result.action).toBe('would-rescue');
    expect(lines.join('\n')).toMatch(/DRY RUN/);
    const [real] = await keep();
    expect(real.action).toBe('rescued');
  });
});
