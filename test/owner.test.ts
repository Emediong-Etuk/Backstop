// The borrower's own path: withdraw everything with one signature, and nobody else can.
import { describe, expect, it } from 'vitest';
import { withdrawParts } from '@backstop/contracts';
import { createWorld, DEFAULTS, expectAccepted, owner, stranger } from './harness.js';

describe('Withdrawing from the vault', () => {
  it('the owner takes back the loan key and the whole reserve in one transaction, with one signature', async () => {
    const world = createWorld();
    const parts = withdrawParts({
      vault: world.vault,
      key: world.utxos.key,
      reserve: world.utxos.reserve,
      ownerSigner: owner.signer,
      minerFeeSats: 2_000n,
      toLockingBytecode: owner.lockingBytecode,
    });
    await expectAccepted(world, parts);
    expect(parts.outputs[0].token).toEqual(world.utxos.key.token);
    expect(parts.outputs[1].amount).toBe(DEFAULTS.reserveSats - 2_000n);
  });

  it('the owner can withdraw at any time, including while the loan is below the trigger', async () => {
    const world = createWorld({ priceCents: DEFAULTS.crashPriceCents });
    await expectAccepted(world, withdrawParts({
      vault: world.vault, key: world.utxos.key, reserve: world.utxos.reserve,
      ownerSigner: owner.signer, minerFeeSats: 2_000n, toLockingBytecode: owner.lockingBytecode,
    }));
  });

  it('a stranger cannot withdraw with their own key', () => {
    const world = createWorld();
    const parts = withdrawParts({
      vault: world.vault, key: world.utxos.key, reserve: world.utxos.reserve,
      ownerSigner: stranger.signer, minerFeeSats: 2_000n, toLockingBytecode: stranger.lockingBytecode,
    });
    expect(world.build(parts)).toFailRequireWith(/Only the vault owner can withdraw/);
  });

  it("a stranger cannot withdraw by presenting the owner's public key with their own signature", () => {
    const world = createWorld();
    const unlocker = world.vault.unlock.ownerSpend(owner.publicKey, stranger.signer);
    const builder = world.build({
      inputs: [{ utxo: world.utxos.key, unlocker }, { utxo: world.utxos.reserve, unlocker }],
      outputs: [
        { to: stranger.lockingBytecode, amount: world.utxos.key.satoshis, token: world.utxos.key.token },
        { to: stranger.lockingBytecode, amount: DEFAULTS.reserveSats - 2_000n },
      ].map((o) => ({ ...o, to: Buffer.from(o.to, 'hex') })),
    });
    expect(builder).toFailRequireWith(/Only the vault owner can withdraw/);
  });

  it('nobody can take the reserve alone by calling the rescue path', () => {
    const world = createWorld();
    const builder = world.build({
      inputs: [{ utxo: world.utxos.reserve, unlocker: world.vault.unlock.rescue() }],
      outputs: [{ to: Buffer.from(stranger.lockingBytecode, 'hex'), amount: DEFAULTS.reserveSats - 2_000n }],
    });
    expect(builder).toFailRequireWith(/Vault inputs must be at index 4 and 5/);
  });
});
