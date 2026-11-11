# Backstop XO template

`backstop.template.json` expresses Backstop as an [XO](https://xo.cash) template, for the BCH BLAZE "Build with XO" bounty. It is generated from `src/template.ts` by `npm run xo:export`, and it reads the compiled bytecode of `Backstop.cash` and Paryon's contracts, so it cannot drift from the contracts the tests cover.

## What it describes

| Action | Role | Transaction |
|---|---|---|
| `protectLoan` | owner (borrower) | The loan key and a reserve go into the vault. An OP_RETURN publishes the vault's rules. Composable: the wallet adds funding coins and change. |
| `rescue` | keeper (anyone) | Paryon's add-collateral transaction. Inputs 0–3 are Paryon's price contract, loan, sidecar and manage function; inputs 4–5 are the vault. Outputs return everything unchanged except the loan (+ top-up), the reserve (− top-up − fee − reward) and the keeper's reward. No keys needed. |
| `withdraw` | owner | Both vault UTXOs back to the owner, signed with `ownerKey` through `ownerSpend`. |

The `vault` locking script is P2SH32 of CashScript's exact redeem script: constructor arguments, then the Backstop bytecode. Paryon's four contracts appear as P2SH32 locking scripts built from their unmodified bytecode in `@paryonusd/contracts@1.1.0`.

## How it was checked (offline)

`test/xo.test.ts`, using XO's own `@xo-cash/utils`:

- `parseTemplate` accepts it, before and after a JSON round trip.
- A reference check: every script, input, output, locking script, transaction and variable it mentions is defined. `parseTemplate` checks only shape.
- `compileCashAssemblyString` compiles each script, with variables converted the way `@xo-cash/engine` converts them. The results match CashScript **byte for byte**:
  - the vault redeem script and P2SH32 address;
  - Paryon's four redeem scripts and the manage locking bytecode;
  - all six rescue unlocking scripts, from a rescue the covenant accepts;
  - the withdraw unlocking script after the signature and public key;
  - the setup OP_RETURN, which decodes back into the vault rules;
  - the rescue and withdraw amounts.
- Swapping two constructor arguments in the template makes three of these tests fail.
- The committed JSON equals the current template.

## Not checked yet

- **Not run in the XO engine or the debug tool.** The engine needs a live chipnet Electrum connection over WSS to start; the development sandbox has none. Next step: load `backstop.template.json` at https://blaze.xo.cash on chipnet.
- **The owner's key hash is a separate variable.** The keeper holds no keys, yet must rebuild the vault script, so `ownerPkh` is a variable rather than derived from `ownerKey` in the script. The owner must supply the HASH160 of `ownerKey`'s public key; otherwise `withdraw` fails. It fails safely: funds stay in the vault, and only a matching key can ever withdraw.
- **The setup's loan-key input has no unlocking script.** It is expected to be unlocked by the template of the wallet that holds the key (for example the P2PKH template). This is unverified.
- **Signatures** (`ownerKey.schnorr_signature.all_outputs`) were not compiled offline; the compiler has no signing context.

## Using it in the debug tool

1. Export the template:

   ```bash
   npm run xo:export
   ```

2. Import `xo/backstop.template.json` at https://blaze.xo.cash (chipnet).

3. For a real vault from the demo, print every variable value and the outpoints, read from chain:

   ```bash
   npm run xo:values -- <setup txid> rescue
   ```

   Or, for a withdraw:

   ```bash
   npm run xo:values -- <setup txid> withdraw
   ```

Values follow the XO engine's conventions: integers and satoshi amounts as numbers, bytes as hex, token categories in display order.
