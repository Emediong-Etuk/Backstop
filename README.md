# Backstop

A pre-funded rescue for ParyonUSD loans on Bitcoin Cash. BCH BLAZE 2026 entry.

A borrower moves their loan key and a BCH reserve into a vault once. If BCH falls far enough that the loan nears liquidation, **anyone** can broadcast a rescue that moves part of the reserve into the borrower's own loan as extra collateral. The borrower doesn't need to be online or sign anything. They also don't need to trust whoever sends the rescue: the vault's contract only accepts a correct rescue.

> Status: **Phase 1 of 6**: the contract and its tests. Keeper, demo oracle, web app and chipnet deployment come next. Research notes: [`docs/PHASE0.md`](docs/PHASE0.md).

## Run the tests

Requires Node 22+.

```bash
npm install
```

```bash
npm test
```

`npm test` compiles `contracts/Backstop.cash` and runs the Vitest suite on CashScript's `MockNetworkProvider`. The tests use **Paryon's real compiled contracts** from `@paryonusd/contracts@1.1.0`, not a mock loan.

## How it works

The vault is two outputs locked by `Backstop.cash`:

- the **key output**: 1000 sats plus the loan's minting loan-key NFT
- the **reserve output**: the borrower's BCH reserve

They are separate because Paryon requires the loan key to come back with exactly the BCH it went in with (`manage.cash:121`).

A rescue is Paryon's own add-collateral transaction (`manage` with no repayment), with the vault at inputs 4 and 5:

```
in 0  Paryon price contract                out 0  price contract, unchanged
in 1  Paryon loan                          out 1  loan, same state, collateral + top-up
in 2  Paryon loan sidecar                  out 2  sidecar, unchanged
in 3  Paryon manage function               out 3  manage function, unchanged
in 4  vault key                            out 4  vault key, unchanged
in 5  vault reserve                        out 5  vault reserve, minus top-up and capped overhead
                                           out 6  optional keeper reward (BCH only)
```

The price comes from Paryon's price contract at input 0. Paryon updates it only from oracle messages signed by the configured oracle key (`checkDataSig`) and only with newer sequence numbers. So a rescue triggers on exactly the price Paryon would liquidate at, and an old low price cannot be replayed.

## What the borrower is protected from

Every protection below is a `require` in `contracts/Backstop.cash`, with a comment naming the attack it stops, and has a test in `test/`.

Each rescue test runs twice. Once against Paryon's real contracts, and once with Paryon's checks replaced by permissive stand-ins (`test/fixtures/PermissiveStandIn.cash`). In the second run the failure has to come from Backstop's own `require`, so no protection depends on Paryon catching the same mistake.

| A rescue cannot… | Test (`test/rescue.test.ts`) |
|---|---|
| run while the loan is above the trigger | a rescue while the loan is not in danger |
| run again at the same price once the loan is safe (replay) | a second rescue at the same price… |
| run before the cooldown | a rescue before the cooldown has passed |
| add more than the per-rescue limit, or lift the loan above the target | a top-up above the vault limit / …above the target |
| pay fees and keeper reward above the limit | fees plus keeper reward above the vault limit |
| drain the reserve through many tiny rescues | a keeper draining the reserve through many tiny rescues |
| send the loan key anywhere but the vault, or change it | the loan key being sent anywhere… / …changed commitment / …without its minting capability |
| mint a copy of the loan key (it is a minting NFT) | a keeper minting a copy… / …hiding a copy… in the manage function output |
| withdraw collateral, increase debt, or change the interest manager | a keeper withdrawing collateral… / …increasing the loan's debt / …making themselves the loan's interest manager |
| move the remaining reserve elsewhere, add outputs, or add inputs | the remaining reserve being sent… / an extra output… / an extra input… |
| top up a different loan, use a fake price contract, or bypass Paryon's manage function | the top-up going into somebody else's loan / a fake price contract… / some other contract standing in for… |

The owner can always withdraw the key and the whole reserve with one signature, and nobody else can (`test/owner.test.ts`). Setup, and rebuilding a vault from its setup transaction alone, are covered in `test/setup.test.ts`. The price contract's signature and replay checks are in `test/price.test.ts`. The full demo sequence is in `test/story.test.ts`.

## Known limits (so far)

- **Cooldown:** the script checks the cooldown that the rescue declares as its relative timelock. The node then enforces the vault's real age (BIP68). The mock network can't simulate block age, so the tests cover only the script side.
- **Price staleness:** the rescue uses whatever Paryon's price contract holds. If nobody updates it, no rescue happens, and no liquidation happens either. With several price threads, a keeper can choose the most out-of-date one. The target ratio, the cooldown, and the fact that the money goes into the borrower's own loan limit what that can achieve.
- **Trust in Paryon:** Paryon's team can migrate the price contract code (`contract_overview.md:539`). Backstop requires the price contract output to come back unchanged, but a migrated contract could still report a wrong price. Every Paryon user already carries this risk.
- **Demo setup on chipnet:** there is no public Paryon deployment on chipnet. The demo will deploy Paryon's unmodified add-collateral contracts with our own token categories and a clearly labelled demo oracle key. See `docs/PHASE0.md`.

## Layout

```
contracts/   Backstop.cash, compiled artifact, shared TypeScript helpers (@backstop/contracts)
test/        Vitest suite on MockNetworkProvider
docs/        research and design notes
```
