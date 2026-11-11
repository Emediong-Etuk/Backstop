// The borrower's own path: withdraw everything with one signature, and nobody else can.
import { describe, expect, it } from 'vitest';
import { withdrawParts, withdrawWithWalletCoinParts } from '@backstop/contracts';
import { createWorld, DEFAULTS, expectAccepted, keeper, owner, stranger } from './harness.js';

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

describe('Withdrawing by spending a wallet coin (for wallets that only sign their own coins)', () => {
  function setUp(coinOwner = owner) {
    const world = createWorld();
    const walletCoin = world.addUtxo(coinOwner.lockingBytecode, { vout: 0, satoshis: 20_000n });
    const parts = withdrawWithWalletCoinParts({
      vault: world.vault, params: world.params, key: world.utxos.key, reserve: world.utxos.reserve,
      walletCoin: { ...walletCoin, lockingBytecode: owner.lockingBytecode }, walletSigner: coinOwner.signer, minerFeeSats: 3_000n,
    });
    parts.inputs[2].utxo = walletCoin;
    return { world, parts };
  }

  it('the owner takes back the loan key and the whole reserve by signing only their own coin', async () => {
    const { world, parts } = setUp();
    await expectAccepted(world, parts);
    expect(parts.outputs[0].token).toEqual(world.utxos.key.token);
    expect(parts.outputs[1].amount).toBe(DEFAULTS.reserveSats + 20_000n - 3_000n);
  });

  it("a stranger cannot withdraw by spending their own coin instead of the owner's", () => {
    const { world, parts } = setUp(stranger);
    expect(world.build(parts)).toFailRequireWith(/Only the vault owner can withdraw/);
  });

  it("the vault cannot be sent anywhere but the owner's address, even with the owner's coin", () => {
    const { world, parts } = setUp();
    parts.outputs[1].to = Buffer.from(stranger.lockingBytecode, 'hex');
    expect(world.build(parts)).toFailRequireWith(/Withdraw must pay the vault owner/);
  });

  it('no extra output can be added to a withdraw', () => {
    const { world, parts } = setUp();
    parts.outputs[1].amount -= 2_000n;
    parts.outputs.push({ to: Buffer.from(stranger.lockingBytecode, 'hex'), amount: 1_000n });
    expect(world.build(parts)).toFailRequireWith(/Withdraw may have at most 3 outputs|Withdraw must pay the vault owner/);
  });

  it('a withdraw cannot burn the reserve as miner fee', () => {
    const { world, parts } = setUp();
    parts.outputs[1].amount = 10_000n; // the rest would go to miners
    expect(world.build(parts)).toFailRequireWith(/Withdraw fee exceeds the vault's limit/);
  });

  it('a keeper cannot use the withdraw path without a coin from the owner', () => {
    const world = createWorld();
    const keeperCoin = world.addUtxo(keeper.lockingBytecode, { vout: 0, satoshis: 20_000n });
    const unlocker = world.vault.unlock.ownerWithdraw(2n);
    const to = Buffer.from(owner.lockingBytecode, 'hex');
    const builder = world.build({
      inputs: [{ utxo: world.utxos.key, unlocker }, { utxo: world.utxos.reserve, unlocker }, { utxo: keeperCoin, unlocker: keeper.signer.unlockP2PKH() }],
      outputs: [{ to, amount: world.utxos.key.satoshis, token: world.utxos.key.token }, { to, amount: DEFAULTS.reserveSats + 17_000n }],
    });
    expect(builder).toFailRequireWith(/Only the vault owner can withdraw/);
  });
});
