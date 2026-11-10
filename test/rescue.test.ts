// What a rescue can and cannot do.
//
// Every test runs twice:
//   - against Paryon's real compiled contracts (@paryonusd/contracts 1.1.0), and
//   - with Paryon's checks removed (permissive stand-ins at Paryon's input positions).
// The second run shows that each protection is enforced by Backstop's own require,
// so no guarantee depends on Paryon's code happening to reject the same transaction first.
import { describe, expect, it } from 'vitest';
import { hexToBin } from '@bitauth/libauth';
import { collateralRatioBps, encodeLoanState, parseLoanState, readRescueState, type TransactionParts } from '@backstop/contracts';
import { BCH, createWorld, DEFAULTS, dollars, expectAccepted, expectRejected, keeper, LOAN_KEY_CATEGORY, PARYON_TOKEN_ID, stranger, type Mode, type World } from './harness.js';

const MODES: Array<[string, Mode]> = [
  ["against Paryon's real contracts", 'paryon'],
  ["with Paryon's own checks removed", 'standIn'],
];

/** Moves the world forward to the outputs of a rescue that was just sent. */
function advance(world: World, txid: string, parts: TransactionParts) {
  const names = ['price', 'loan', 'sidecar', 'manage', 'key', 'reserve'] as const;
  names.forEach((name, vout) => {
    const out = parts.outputs[vout];
    const lockingBytecode = typeof out.to === 'string' ? out.to : Buffer.from(out.to).toString('hex');
    world.utxos[name] = { txid, vout, satoshis: out.amount, token: out.token, lockingBytecode };
  });
}

describe.each(MODES)('A rescue %s', (_label, mode) => {
  describe('does its job', () => {
    it('moves reserve BCH into the loan when it falls below the trigger, and the loan key returns to the vault', async () => {
      const world = createWorld({ mode });
      const before = readRescueState(world.utxos);
      expect(collateralRatioBps(before.collateralSats, before.debtCents, before.priceCents)).toBe(11_739n); // 117%

      const parts = world.rescue();
      const topUp = world.plannedTopUp();
      await expectAccepted(world, parts);

      const loanOut = parts.outputs[1];
      expect(loanOut.amount).toBe(DEFAULTS.collateralSats + topUp);
      expect(loanOut.token?.nft?.commitment).toBe(world.utxos.loan.token?.nft?.commitment);
      // Lifted to just under the 150% target (integer rounding always errs below the target).
      const after = collateralRatioBps(loanOut.amount, before.debtCents, before.priceCents);
      expect(after).toBeLessThanOrEqual(15_000n);
      expect(after).toBeGreaterThanOrEqual(14_990n);

      const keyOut = parts.outputs[4];
      expect(keyOut.to).toEqual(hexToBin(world.vault.lockingBytecode));
      expect(keyOut.token).toEqual(world.utxos.key.token);
      // The borrower paid only the top-up plus the capped overhead.
      expect(parts.outputs[5].amount).toBe(DEFAULTS.reserveSats - topUp - DEFAULTS.minerFeeSats - DEFAULTS.keeperRewardSats);
    });

    it('needs no signature from the borrower and no BCH from the keeper', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      // Six inputs: four Paryon contracts and the two vault UTXOs. None is a wallet input.
      expect(parts.inputs.map((i) => i.utxo.lockingBytecode)).toEqual([
        world.contracts.price.lockingBytecode,
        world.contracts.loan.lockingBytecode,
        world.contracts.sidecar.lockingBytecode,
        world.contracts.manage.lockingBytecode,
        world.vault.lockingBytecode,
        world.vault.lockingBytecode,
      ]);
      expect(world.build(parts)).not.toFailRequire();
    });

    it('may use the whole per-rescue limit even if that does not reach the target', async () => {
      const world = createWorld({ mode, rules: { maxTopUpSats: BCH / 20n } }); // 0.05 BCH
      await expectAccepted(world, world.rescue({ topUpSats: BCH / 20n }));
    });
  });

  describe('protects the borrower from', () => {
    it('a rescue while the loan is not in danger (price above the trigger)', () => {
      const world = createWorld({ mode, priceCents: DEFAULTS.safePriceCents });
      expectRejected(world, world.rescue({ topUpSats: BCH / 10n }), /Loan is not below the trigger ratio/);
    });

    it('a second rescue at the same price once the loan is back above the trigger (replay)', async () => {
      const world = createWorld({ mode });
      const first = world.rescue();
      const { txid } = await expectAccepted(world, first);
      advance(world, txid, first);
      expectRejected(world, world.rescue({ topUpSats: BCH / 20n }), /Loan is not below the trigger ratio/);
    });

    it('a rescue before the cooldown has passed', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      // The reserve input must declare the cooldown as its relative timelock. The node then refuses
      // the transaction until the reserve UTXO really is that old (BIP68); the mock network cannot
      // simulate block age, so this test checks the script side: declaring less is rejected.
      parts.inputs[5].options = { sequence: Number(world.params.cooldownBlocks) - 1 };
      expectRejected(world, parts, /Reserve is still in its cooldown/);
    });

    it('a top-up above the vault limit', () => {
      const world = createWorld({ mode, rules: { maxTopUpSats: BCH / 10n } });
      expectRejected(world, world.rescue({ topUpSats: BCH / 10n + 1n }), /Top-up is above the vault's limit/);
    });

    it('a top-up that lifts the loan above the target', () => {
      const world = createWorld({ mode });
      expectRejected(world, world.rescue({ topUpSats: world.plannedTopUp() + 1_000n }), /Rescue would lift the loan above the target ratio/);
    });

    it('fees plus keeper reward above the vault limit', () => {
      const world = createWorld({ mode });
      // 3000 fee + 7001 reward = 10001 sats, one more than the 10000 limit.
      expectRejected(world, world.rescue({ keeperRewardSats: 7_001n }), /Fee and keeper reward exceed the vault's limit/);
    });

    it('a keeper draining the reserve through many tiny rescues', () => {
      const world = createWorld({ mode });
      // 1000 sats leaves the loan below the trigger, while still paying the full overhead.
      expectRejected(world, world.rescue({ topUpSats: 1_000n }), /Rescue too small/);
    });

    it('the loan key being sent anywhere but the vault', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      parts.outputs[4].to = hexToBin(stranger.lockingBytecode);
      expectRejected(world, parts, /Loan key must return to the vault/, /Recreate loanKey - invalid lockingBytecode/);
    });

    it('the loan key coming back with a changed commitment', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      parts.outputs[4].token = { category: LOAN_KEY_CATEGORY, amount: 0n, nft: { capability: 'minting', commitment: '01' } };
      expectRejected(world, parts, /Loan key must return unchanged/, /Recreate loanKey - invalid nftCommitment/);
    });

    it('the loan key coming back without its minting capability', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      parts.outputs[4].token = { category: LOAN_KEY_CATEGORY, amount: 0n, nft: { capability: 'mutable', commitment: '' } };
      expectRejected(world, parts, /Loan key must return unchanged/, /Recreate loanKey - invalid tokenCategory/);
    });

    it('a keeper minting a copy of the loan key for themselves', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      // The loan key is a minting NFT, so the transaction could create a second key.
      // Paryon accepts this; only Backstop stops it.
      parts.outputs[6] = { to: hexToBin(keeper.lockingBytecode), amount: 1_000n, token: { category: LOAN_KEY_CATEGORY, amount: 0n, nft: { capability: 'minting', commitment: '' } } };
      expectRejected(world, parts, /Keeper reward must hold no tokens/);
    });

    it('a keeper withdrawing collateral with the key', () => {
      // At $300 a 0.1 BCH withdrawal keeps the loan above 110%, so Paryon itself would allow it.
      const world = createWorld({ mode, priceCents: DEFAULTS.safePriceCents });
      const parts = world.rescue({ topUpSats: 0n });
      parts.outputs[1].amount -= BCH / 10n;
      parts.outputs[6].amount += BCH / 10n;
      expectRejected(world, parts, /Rescue must add collateral/);
    });

    it("a keeper increasing the loan's debt", () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      const state = parseLoanState(world.utxos.loan.token!.nft!.commitment);
      parts.outputs[1].token = { ...parts.outputs[1].token!, nft: { capability: 'mutable', commitment: encodeLoanState({ ...state, debtCents: state.debtCents + dollars(100) }) } };
      expectRejected(world, parts, /Loan state must not change/, /Invalid state loan contract - wrong nftCommitment/);
    });

    it("a keeper making themselves the loan's interest manager", () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      const takeover = '01ffff0000'; // interestManager 0x01 with the widest rate range
      const state = parseLoanState(world.utxos.loan.token!.nft!.commitment);
      parts.outputs[1].token = { ...parts.outputs[1].token!, nft: { capability: 'mutable', commitment: encodeLoanState({ ...state, interestManagerConfiguration: takeover }) } };
      // Paryon's manage function lets whoever builds the transaction choose this setting.
      if (mode === 'paryon') parts.inputs[3].unlocker = world.paryon.manage.unlock.manage(0n, takeover);
      expectRejected(world, parts, /Loan state must not change/);
    });

    it('the remaining reserve being sent anywhere but the vault', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      parts.outputs[5].to = hexToBin(keeper.lockingBytecode);
      expectRejected(world, parts, /Remaining reserve must return to the vault/);
    });

    it('an extra output siphoning value', () => {
      const world = createWorld({ mode });
      const parts = world.rescue({ keeperRewardSats: 1_000n });
      // Overhead stays within the limit (1000 reward + 1000 extra + 3000 fee); only the extra output is wrong.
      parts.outputs[5].amount -= 1_000n;
      parts.outputs.push({ to: hexToBin(keeper.lockingBytecode), amount: 1_000n });
      expectRejected(world, parts, /Rescue may have at most 7 outputs/);
    });

    it('an extra input smuggled into the rescue', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      const extra = world.addUtxo(keeper.lockingBytecode, { vout: 0, satoshis: 10_000n });
      parts.inputs.push({ utxo: extra, unlocker: keeper.signer.unlockP2PKH() });
      expectRejected(world, parts, /Rescue must have exactly 6 inputs/);
    });

    it('the top-up going into somebody else\'s loan', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      // Another loan, not created together with this borrower's sidecar.
      const otherLoan = world.addUtxo(world.contracts.loan.lockingBytecode, { vout: 2, satoshis: 2n * BCH, token: world.utxos.loan.token });
      parts.inputs[1].utxo = otherLoan;
      parts.outputs[1].amount = otherLoan.satoshis + world.plannedTopUp();
      // Paryon's Loan contract also insists on its own sidecar right after it (Loan.cash:30).
      expectRejected(world, parts, /Input 1 must be the loan of this sidecar/, /at input 1 in contract Loan\.cash at line 30/);
    });

    it('a fake price contract reporting a low price', () => {
      const world = createWorld({ mode, priceCents: DEFAULTS.safePriceCents });
      const parts = world.rescue({ topUpSats: BCH / 10n });
      const fakeCategory = 'ee'.repeat(32);
      const fake = world.addUtxo(world.contracts.price.lockingBytecode, {
        vout: 0, satoshis: 1_000n,
        token: { category: fakeCategory, amount: 0n, nft: { capability: 'mutable', commitment: '00' + 'e8030000' + '01000000' } }, // $0.01
      });
      parts.inputs[0].utxo = fake;
      parts.outputs[0].token = fake.token;
      expectRejected(world, parts, /Input 0 must be a Paryon price contract/, /at input 3 in contract manageLoan\.cash at line 35/);
    });

    it("some other contract standing in for Paryon's manage function", () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      // Paryon's Loan contract checks only the function NFT's category and commitment length,
      // not its contract (Loan.cash:35-41), so Backstop pins the manage function's bytecode.
      const impostorBytecode = keeper.lockingBytecode;
      const impostor = world.addUtxo(impostorBytecode, { vout: 0, satoshis: 1_000n, token: world.utxos.manage.token });
      parts.inputs[3] = { utxo: impostor, unlocker: keeper.signer.unlockP2PKH() };
      parts.outputs[3] = { to: hexToBin(impostorBytecode), amount: 1_000n, token: world.utxos.manage.token };
      expectRejected(world, parts, /Input 3 must be Paryon's manage function/);
    });

    it('vault inputs placed anywhere but positions 4 and 5', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      [parts.inputs[4], parts.inputs[5]] = [parts.inputs[5], parts.inputs[4]];
      [parts.outputs[4], parts.outputs[5]] = [parts.outputs[5], parts.outputs[4]];
      // Paryon expects the loan key at input 4 (manage.cash:45).
      expectRejected(world, parts, /Input 4 must be this loan's minting key/, /at input 3 in contract manageLoan\.cash at line 45/);
    });
  });
});

describe('Paryon category checks use the right byte order', () => {
  it('the vault is bound to the categories shown by wallets and explorers', () => {
    const world = createWorld();
    expect(world.params.paryonTokenId).toBe(PARYON_TOKEN_ID);
    expect(world.params.loanKeyCategory).toBe(LOAN_KEY_CATEGORY);
    expect(world.build(world.rescue())).not.toFailRequire();
  });
});
