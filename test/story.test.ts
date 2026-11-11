// The whole story on Paryon's real contracts, in the order of the demo:
// set up, the price crashes, a keeper rescues the loan, the borrower withdraws.
import { describe, expect, it } from 'vitest';
import {
  buildSetup, collateralRatioBps, isLiquidatable, planRescue, readRescueState, rescueParts, paryonUnlockers, setupParts, withdrawParts,
} from '@backstop/contracts';
import { createWorld, DEFAULTS, dollars, expectAccepted, keeper, owner, priceUpdateParts, signedPriceMessage, track } from './harness.js';

describe('The 3am liquidation that does not happen', () => {
  it('set up with one signature, price crashes, a stranger rescues the loan with no signature from the borrower, the borrower withdraws with one signature', async () => {
    const world = createWorld({ beforeSetup: true, priceCents: DEFAULTS.safePriceCents, priceSequence: 1000n });

    // 1. Set up: one signature moves the key and reserve into the vault.
    const setup = setupParts({
      vault: world.vault, params: world.params, keyUtxo: world.utxos.key, fundingUtxos: [world.utxos.reserve],
      ownerSigner: owner.signer, reserveSats: DEFAULTS.reserveSats, minerFeeSats: 1_500n, changeLockingBytecode: owner.lockingBytecode,
    });
    const setupTx = await buildSetup(world.provider, setup).send();
    track(world, setupTx.txid, setup, ['key', 'reserve']);

    // 2. The price falls from $300 to $258.75. The loan drops from 130% to 112.5%, close to liquidation at 110%.
    const crash = dollars(258.75);
    const signed = await signedPriceMessage({ priceCents: crash, dataSequence: 1010n });
    const update = priceUpdateParts(world, signed, { sequence: 1010n, priceCents: crash });
    track(world, (await expectAccepted(world, update)).txid, update, ['price']);
    const state = readRescueState(world.utxos);
    expect(collateralRatioBps(state.collateralSats, state.debtCents, state.priceCents)).toBe(11_250n);

    // 3. A keeper notices and rescues. It holds no keys that matter and spends none of its own BCH.
    const overheadSats = DEFAULTS.minerFeeSats + DEFAULTS.keeperRewardSats;
    const plan = planRescue({ params: world.params, ...state, overheadSats });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const rescue = rescueParts({
      vault: world.vault, params: world.params, utxos: world.utxos, unlockers: paryonUnlockers(world.paryon, world.utxos.loan),
      topUpSats: plan.topUpSats, minerFeeSats: DEFAULTS.minerFeeSats, keeperRewardSats: DEFAULTS.keeperRewardSats, keeperLockingBytecode: keeper.lockingBytecode,
    });
    const rescueTx = await expectAccepted(world, rescue);
    track(world, rescueTx.txid, rescue, ['price', 'loan', 'sidecar', 'manage', 'key', 'reserve']);

    const after = readRescueState(world.utxos);
    expect(collateralRatioBps(after.collateralSats, after.debtCents, after.priceCents)).toBeGreaterThanOrEqual(14_990n);
    // At an even lower price the loan would have been liquidated without the rescue, but not now.
    const lower = dollars(240);
    expect(isLiquidatable(DEFAULTS.collateralSats, after.debtCents, lower)).toBe(true);
    expect(isLiquidatable(after.collateralSats, after.debtCents, lower)).toBe(false);

    // 4. The borrower withdraws everything with one signature.
    const withdraw = withdrawParts({
      vault: world.vault, key: world.utxos.key, reserve: world.utxos.reserve,
      ownerSigner: owner.signer, minerFeeSats: 2_000n, toLockingBytecode: owner.lockingBytecode,
    });
    await expectAccepted(world, withdraw);
    expect(withdraw.outputs[0].token).toEqual(world.utxos.key.token);
    expect(withdraw.outputs[1].amount).toBe(DEFAULTS.reserveSats - plan.topUpSats - overheadSats - 2_000n);
  });
});
