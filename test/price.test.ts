// The price a rescue relies on.
//
// Backstop reads the price from Paryon's own price contract (input 0 of every add-collateral
// transaction) instead of taking a raw oracle message. That contract checks the oracle signature
// with checkDataSig and only accepts newer messages, so the rescue triggers on exactly the price
// Paryon itself would liquidate at, and an old low price cannot be replayed.
import { describe, expect, it } from 'vitest';
import { readRescueState } from '@backstop/contracts';
import { createWorld, DEFAULTS, dollars, expectAccepted, priceUpdateParts, signedPriceMessage, stranger, track } from './harness.js';

describe("Paryon's price contract (as used by Backstop)", () => {
  it('accepts a correctly signed oracle message, and the next rescue uses the new price', async () => {
    const world = createWorld({ priceCents: DEFAULTS.safePriceCents, priceSequence: 1000n });
    expect(world.build(world.rescue({ topUpSats: 10_000_000n }))).toFailRequireWith(/Loan is not below the trigger ratio/);

    const signed = await signedPriceMessage({ priceCents: DEFAULTS.crashPriceCents, dataSequence: 1010n });
    const update = priceUpdateParts(world, signed, { sequence: 1010n, priceCents: DEFAULTS.crashPriceCents });
    const { txid } = await expectAccepted(world, update);
    track(world, txid, update, ['price']);
    expect(readRescueState(world.utxos).priceCents).toBe(DEFAULTS.crashPriceCents);

    await expectAccepted(world, world.rescue());
  });

  it('rejects a price signed by any key other than the oracle the price contract was built with', async () => {
    const world = createWorld({ priceCents: DEFAULTS.safePriceCents, priceSequence: 1000n });
    const forged = await signedPriceMessage({ priceCents: dollars(1), dataSequence: 1010n, signer: stranger });
    const update = priceUpdateParts(world, forged, { sequence: 1010n, priceCents: dollars(1) });
    // checkDataSig fails, which aborts the script (NULLFAIL) rather than returning false.
    expect(world.build(update)).toFailRequire();
    await expect(world.build(update).send()).rejects.toThrow();
  });

  it('rejects an old oracle message replayed after a newer price was recorded', async () => {
    const world = createWorld({ priceCents: DEFAULTS.safePriceCents, priceSequence: 1000n });
    // An old low price that really was signed by the oracle, at sequence 990.
    const old = await signedPriceMessage({ priceCents: dollars(200), dataSequence: 990n });
    const update = priceUpdateParts(world, old, { sequence: 990n, priceCents: dollars(200) });
    expect(world.build(update)).toFailRequireWith(/Invalid oracle sequence, should be more recent than current contract sequence/);
  });
});
