// What a rescue can and cannot do.
//
// Every test runs twice:
//   - against Paryon's real compiled contracts (@paryonusd/contracts 1.1.0), and
//   - with Paryon's checks removed (permissive stand-ins at Paryon's input positions).
// The second run shows that each protection is enforced by Backstop's own require,
// so no guarantee depends on Paryon's code happening to reject the same transaction first.
import { describe, expect, it } from 'vitest';
import { hexToBin } from '@bitauth/libauth';
import { collateralRatioBps, encodeLoanState, parseLoanState, readRescueState } from '@backstop/contracts';
import { MemCashProvider } from '@backstop/demo';
import { BCH, createWorld, track, DEFAULTS, dollars, expectAccepted, expectRejected, keeper, LOAN_KEY_CATEGORY, PARYON_TOKEN_ID, stranger, type Mode } from './harness.js';

// Where Paryon's real contracts refuse the same change before Backstop's require is reached.
const PARYON_PRICE = /at input 0 in contract PriceContractGuarded\.cash at line (95|96|98|101)/;
const PARYON_PRICE_INPUT = /at input 3 in contract manageLoan\.cash at line 36/;
const PARYON_LOAN = /at input (1|3) in contract (Loan|manageLoan)\.cash at line (31|39|51)/;
const PARYON_LOAN_OUT = /at input 3 in contract manageLoan\.cash at line (112|113)/;
// Rejected by one of Paryon's own contracts (the line differs per attack).
const PARYON_ANY = /at input [0-3] in contract (Loan|manageLoan)\.cash at line (37|115|121|126|127)/;
const PARYON_ZERO_PRICE = /at input 3 in contract manageLoan\.cash at line 99/;
const PARYON_OTHER_LOAN = /at input 3 in contract manageLoan\.cash at line 45/;
const PARYON_MANAGE_OUT = /at input 3 in contract manageLoan\.cash at line 125/;
const PARYON_SIDECAR = /at input 2 in contract Loan\.cash at line (37|39)/;

const MODES: Array<[string, Mode]> = [
  ["against Paryon's real contracts", 'paryon'],
  ["with Paryon's own checks removed", 'standIn'],
];

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
      track(world, txid, first, ['price', 'loan', 'sidecar', 'manage', 'key', 'reserve']);
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

    it('a keeper hiding a copy of the loan key in the manage function output', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      parts.outputs[3] = { to: hexToBin(keeper.lockingBytecode), amount: 1_000n, token: { category: LOAN_KEY_CATEGORY, amount: 0n, nft: { capability: 'minting', commitment: '' } } };
      // Paryon also recreates its manage function there (manage.cash:125).
      expectRejected(world, parts, /Manage function must be returned unchanged/, /at input 3 in contract manageLoan\.cash at line 125/);
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

    // A migrated price contract (Paryon's team holds a migration key) could try to change its own
    // output during a rescue. Paryon's current price contract refuses this itself; Backstop must too.
    it('the price contract coming back at another address', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      parts.outputs[0].to = hexToBin(keeper.lockingBytecode);
      expectRejected(world, parts, /Price contract must be returned unchanged/, PARYON_PRICE);
    });

    it('the price contract coming back without its token', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      parts.outputs[0].token = undefined;
      expectRejected(world, parts, /Price contract must be returned unchanged/, PARYON_PRICE);
    });

    it('the price contract coming back with a different price', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      parts.outputs[0].token = { ...parts.outputs[0].token!, nft: { capability: 'mutable', commitment: '00' + 'e9030000' + '01000000' } };
      expectRejected(world, parts, /Price contract must be returned unchanged/, PARYON_PRICE);
    });

    it('a Paryon loan passed off as the price contract', () => {
      // Loans carry the same Paryon category and capability as price contracts; only the state's
      // first byte tells them apart. A loan's state read as a price could make any loan look in danger.
      const world = createWorld({ mode, priceCents: DEFAULTS.safePriceCents });
      const parts = world.rescue({ topUpSats: BCH / 10n });
      const loanAsPrice = world.addUtxo(world.contracts.price.lockingBytecode, {
        vout: 0, satoshis: 1_000n,
        token: { category: PARYON_TOKEN_ID, amount: 0n, nft: { capability: 'mutable', commitment: '01' + 'e8030000' + '01000000' } },
      });
      parts.inputs[0] = { ...parts.inputs[0], utxo: loanAsPrice };
      parts.outputs[0] = { ...parts.outputs[0], token: loanAsPrice.token };
      expectRejected(world, parts, /Input 0 must be a Paryon price contract/, PARYON_PRICE_INPUT);
    });

    it('the price contract carrying tokens out of the rescue', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      const withTokens = world.addUtxo(world.contracts.price.lockingBytecode, {
        vout: 0, satoshis: world.utxos.price.satoshis, token: { ...world.utxos.price.token!, amount: 1_000n },
      });
      parts.inputs[0] = { ...parts.inputs[0], utxo: withTokens };
      parts.outputs[0] = { ...parts.outputs[0], token: withTokens.token };
      expectRejected(world, parts, /Price contract must be returned unchanged/, PARYON_PRICE);
    });

    it('the sidecar being moved', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      parts.outputs[2].to = hexToBin(keeper.lockingBytecode);
      expectRejected(world, parts, /Loan sidecar must be returned unchanged/, PARYON_SIDECAR);
    });

    it('the sidecar losing its token', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      parts.outputs[2].token = undefined;
      expectRejected(world, parts, /Loan sidecar must be returned unchanged/, PARYON_SIDECAR);
    });

    it('the sidecar coming back with a changed commitment', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      parts.outputs[2].token = { ...parts.outputs[2].token!, nft: { capability: 'none', commitment: 'ff' } };
      expectRejected(world, parts, /Loan sidecar must be returned unchanged/, PARYON_SIDECAR);
    });

    it('a reserve input carrying tokens (the rescue would burn them)', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      const tokenReserve = world.addUtxo(world.vault.lockingBytecode, {
        vout: 1, satoshis: world.utxos.reserve.satoshis, token: { category: 'dd'.repeat(32), amount: 1_000n },
      });
      parts.inputs[5] = { ...parts.inputs[5], utxo: tokenReserve };
      // Carry the tokens on, so the transaction is well formed; the input check comes first.
      parts.outputs[5] = { ...parts.outputs[5], token: tokenReserve.token };
      expectRejected(world, parts, /Reserve input must hold no tokens/);
    });

    // Several requires share one message (e.g. "Price contract must be returned unchanged"). Each
    // test below breaks exactly one of them, so every single check is shown to matter on its own.
    it('the price contract coming back with a lesser capability', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      parts.outputs[0].token = { ...parts.outputs[0].token!, nft: { ...parts.outputs[0].token!.nft!, capability: 'none' } };
      expectRejected(world, parts, /Price contract must be returned unchanged/, PARYON_PRICE);
    });

    it('a loan input that is not a mutable Paryon NFT', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      const frozen = world.addUtxo(world.contracts.loan.lockingBytecode, {
        vout: 2, satoshis: world.utxos.loan.satoshis, token: { ...world.utxos.loan.token!, nft: { ...world.utxos.loan.token!.nft!, capability: 'none' } },
      });
      // Same transaction as the sidecar, so only the category check is wrong.
      frozen.txid = world.utxos.sidecar.txid;
      parts.inputs[1] = { ...parts.inputs[1], utxo: frozen };
      parts.outputs[1] = { ...parts.outputs[1], token: frozen.token };
      expectRejected(world, parts, /Input 1 must be a Paryon loan/, PARYON_LOAN);
    });

    it('a price contract passed off as the loan', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      const state = world.utxos.loan.token!.nft!.commitment;
      const priceAsLoan = world.addUtxo(world.contracts.loan.lockingBytecode, {
        vout: 2, satoshis: world.utxos.loan.satoshis, token: { ...world.utxos.loan.token!, nft: { capability: 'mutable', commitment: '00' + state.slice(2) } },
      });
      priceAsLoan.txid = world.utxos.sidecar.txid;
      parts.inputs[1] = { ...parts.inputs[1], utxo: priceAsLoan };
      parts.outputs[1] = { ...parts.outputs[1], token: priceAsLoan.token };
      expectRejected(world, parts, /Input 1 must be a Paryon loan/, PARYON_LOAN);
    });

    it('a loan from the same transaction that is not right before the sidecar', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      const neighbour = world.addUtxo(world.contracts.loan.lockingBytecode, { vout: 0, satoshis: world.utxos.loan.satoshis, token: world.utxos.loan.token });
      neighbour.txid = world.utxos.sidecar.txid;
      parts.inputs[1] = { ...parts.inputs[1], utxo: neighbour };
      expectRejected(world, parts, /Input 1 must be the loan of this sidecar/, PARYON_LOAN);
    });

    it('the loan being moved to another contract', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      parts.outputs[1].to = hexToBin(keeper.lockingBytecode);
      expectRejected(world, parts, /Loan must stay in the Paryon loan contract/, PARYON_LOAN_OUT);
    });

    it('the loan coming back with a lesser capability', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      parts.outputs[1].token = { ...parts.outputs[1].token!, nft: { ...parts.outputs[1].token!.nft!, capability: 'none' } };
      expectRejected(world, parts, /Loan must stay in the Paryon loan contract/, PARYON_LOAN_OUT);
    });

    it('the loan receiving tokens', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      // Tokens brought in on the price contract and passed to the loan; the price output keeps its state.
      const withTokens = world.addUtxo(world.contracts.price.lockingBytecode, {
        vout: 0, satoshis: world.utxos.price.satoshis, token: { ...world.utxos.price.token!, amount: 1_000n },
      });
      parts.inputs[0] = { ...parts.inputs[0], utxo: withTokens };
      parts.outputs[1].token = { ...parts.outputs[1].token!, amount: 1_000n };
      expectRejected(world, parts, /Loan must not receive tokens/, PARYON_ANY);
    });

    it('the sidecar turned into a minting copy of the loan key', async () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      parts.outputs[2].token = { ...parts.outputs[2].token!, nft: { ...parts.outputs[2].token!.nft!, capability: 'minting' } };
      if (mode === 'paryon') {
        // CashScript's debugger cannot map Paryon's failing line here (it crashes instead), so check
        // with the in-memory node, which runs the real BCH VM: it refuses the attack, and the same
        // rescue without the change is accepted by a fresh node.
        const node = createWorld({ mode, provider: new MemCashProvider() });
        const attack = node.rescue();
        attack.outputs[2].token = { ...attack.outputs[2].token!, nft: { ...attack.outputs[2].token!.nft!, capability: 'minting' } };
        await expect(node.provider.sendRawTransaction(node.build(attack).build())).rejects.toThrow(/error in evaluating input index 2/);
        const control = createWorld({ mode, provider: new MemCashProvider() });
        await expect(control.provider.sendRawTransaction(control.build(control.rescue()).build())).resolves.toMatch(/^[0-9a-f]{64}$/);
      } else {
        expectRejected(world, parts, /Loan sidecar must be returned unchanged/);
      }
    });

    it("a manage function input with the wrong token", () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      const wrong = world.addUtxo(world.contracts.manage.lockingBytecode, {
        vout: 0, satoshis: world.utxos.manage.satoshis, token: { ...world.utxos.manage.token!, nft: { ...world.utxos.manage.token!.nft!, capability: 'mutable' } },
      });
      parts.inputs[3] = { ...parts.inputs[3], utxo: wrong };
      parts.outputs[3] = { ...parts.outputs[3], token: { ...world.utxos.manage.token! } };
      expectRejected(world, parts, /Input 3 must be Paryon's manage function/, PARYON_ANY);
    });

    it('a manage function input with the wrong commitment', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      const wrong = world.addUtxo(world.contracts.manage.lockingBytecode, {
        vout: 0, satoshis: world.utxos.manage.satoshis, token: { ...world.utxos.manage.token!, nft: { ...world.utxos.manage.token!.nft!, commitment: '03' } },
      });
      parts.inputs[3] = { ...parts.inputs[3], utxo: wrong };
      parts.outputs[3] = { ...parts.outputs[3], token: wrong.token };
      expectRejected(world, parts, /Input 3 must be Paryon's manage function/);
    });

    it('the manage function coming back with the wrong token', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      parts.outputs[3].token = { ...parts.outputs[3].token!, nft: { capability: 'none', commitment: '02' }, category: LOAN_KEY_CATEGORY };
      expectRejected(world, parts, /Manage function must be returned unchanged/, PARYON_ANY);
    });

    it('the manage function moved to another address, token and all', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      parts.outputs[3].to = hexToBin(keeper.lockingBytecode);
      expectRejected(world, parts, /Manage function must be returned unchanged/, PARYON_MANAGE_OUT);
    });

    it('the manage function coming back with the wrong commitment', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      parts.outputs[3].token = { ...parts.outputs[3].token!, nft: { ...parts.outputs[3].token!.nft!, commitment: '03' } };
      expectRejected(world, parts, /Manage function must be returned unchanged/, PARYON_ANY);
    });

    it('the loan key coming back with a different value', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      parts.outputs[4].amount += 1_000n;
      parts.outputs[5].amount -= 1_000n;
      expectRejected(world, parts, /Loan key must return unchanged/, PARYON_ANY);
    });

    it('the remaining reserve carrying a copy of the loan key', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      parts.outputs[5].token = { category: LOAN_KEY_CATEGORY, amount: 0n, nft: { capability: 'none', commitment: '' } };
      expectRejected(world, parts, /Remaining reserve must hold no tokens/);
    });

    it('a price of zero, which would make every loan look in danger', () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      const zero = world.addUtxo(world.contracts.price.lockingBytecode, {
        vout: 0, satoshis: world.utxos.price.satoshis,
        token: { ...world.utxos.price.token!, nft: { capability: 'mutable', commitment: '00' + 'e8030000' + '00000000' } },
      });
      parts.inputs[0] = { ...parts.inputs[0], utxo: zero };
      parts.outputs[0] = { ...parts.outputs[0], token: zero.token };
      expectRejected(world, parts, /Price must be positive/, PARYON_ZERO_PRICE);
    });

    it("another borrower's loan topped up together with its own sidecar", () => {
      const world = createWorld({ mode });
      const parts = world.rescue();
      // A complete, correctly paired loan and sidecar, but for a different loan key.
      const otherTxid = 'ab'.repeat(32);
      const otherLoan = world.addUtxo(world.contracts.loan.lockingBytecode, { txid: otherTxid, vout: 2, satoshis: world.utxos.loan.satoshis, token: world.utxos.loan.token });
      const otherSidecar = world.addUtxo(world.contracts.sidecar.lockingBytecode, {
        txid: otherTxid, vout: 3, satoshis: world.utxos.sidecar.satoshis, token: { ...world.utxos.sidecar.token!, category: 'cd'.repeat(32) },
      });
      parts.inputs[1] = { ...parts.inputs[1], utxo: otherLoan };
      parts.inputs[2] = { ...parts.inputs[2], utxo: otherSidecar };
      parts.outputs[2] = { ...parts.outputs[2], token: otherSidecar.token };
      expectRejected(world, parts, /Input 2 must be this loan's sidecar/, PARYON_OTHER_LOAN);
    });

    it('a copy of the loan key, held outside the vault, used in place of the vault key', () => {
      // The loan key is a minting NFT, so copies can exist (minted before setup). A rescue must
      // still use the vault's own key output, not a copy from somewhere else.
      const world = createWorld({ mode });
      const parts = world.rescue();
      const copy = world.addUtxo(keeper.lockingBytecode, { vout: 0, satoshis: world.utxos.key.satoshis, token: world.utxos.key.token });
      parts.inputs[4] = { utxo: copy, unlocker: keeper.signer.unlockP2PKH() };
      // Paryon's manage function wants the key back where it came from, so it refuses first.
      expectRejected(world, parts, /Key must come from this vault/, /at input 3 in contract manageLoan\.cash at line 118/);
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
