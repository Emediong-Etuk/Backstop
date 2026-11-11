# Backstop

A pre-funded rescue for ParyonUSD loans on Bitcoin Cash. BCH BLAZE 2026 entry.

A borrower moves their loan key and a BCH reserve into a vault once. If BCH falls far enough that the loan nears liquidation, **anyone** can broadcast a rescue that moves part of the reserve into the borrower's own loan as extra collateral. The borrower doesn't need to be online or sign anything. They also don't need to trust whoever sends the rescue: the vault's contract only accepts a correct rescue.

> Status: **Phase 4 of 6**: contract, tests, keeper, demo oracle, chipnet demo scripts and web app. XO template and submission material come next. Research notes: [`docs/PHASE0.md`](docs/PHASE0.md).

## Run the tests

Requires Node 22+.

```bash
npm install
```

```bash
npm test
```

`npm test` compiles `contracts/Backstop.cash` and runs the Vitest suite. The tests use **Paryon's real compiled contracts** from `@paryonusd/contracts@1.1.0`, not a mock loan. They run on two networks:

- CashScript's `MockNetworkProvider`, for most tests;
- `@paryonusd/mem-cash` (`test/node.test.ts`), an in-memory node that checks transactions the way BCHN does, including relative timelocks, standardness and fees.

## Run the keeper

The keeper is a stateless process with no keys that matter and no funds. Fees and its optional reward come out of each vault's reserve, within the vault's limit.

```bash
cp keeper/vaults.example.json keeper/vaults.json
```

Put the setup transaction IDs of the vaults to watch in `keeper/vaults.json`. The keeper rebuilds each vault from its setup transaction's OP_RETURN, so the file holds nothing else.

```bash
npm run keeper -- --dry-run
```

```bash
npm run keeper -- --watch
```

`--dry-run` prints the rescue it would send (inputs, outputs, ratio before and after, raw hex) and broadcasts nothing. `--watch` checks every 60 seconds and broadcasts rescues. Other options: `--fee-rate`, `--reward-sats`, `--server`, `--deployment`. Set `KEEPER_REWARD_ADDRESS` in `.env` to collect rewards (see `.env.example`).

The keeper reads `deployments/chipnet.json`, which `npm run demo:deploy` writes. **Discovery for the demo is the local `keeper/vaults.json` list**, not a ChainGraph query: I could not confirm a chipnet ChainGraph instance. Every vault's rules still come from the chain.

## Web app

A static Next.js site (`web/`): no server, no database, no account. It reads everything from the chain in the browser and signs through the borrower's wallet over WalletConnect (`bch_signTransaction`, chain `bch:bchtest`).

- **Connect:** pair a wallet such as Cashonize on chipnet.
- **Set up:** the app finds the loan whose key is in the wallet, shows its health and liquidation price, and suggests a reserve and rescue levels. It explains in plain words what a rescue will do. One signature moves the key and reserve into the vault.
- **Status:** reserve left, the price that triggers a rescue, liquidation price, and the rescue history read from chain. Below that is a single "Withdraw everything" button.

```bash
npm run web:dev
```

Open http://localhost:3000. Wallet connection needs `NEXT_PUBLIC_WC_PROJECT_ID` in `.env` (a free WalletConnect project ID from https://dashboard.reown.com) and a `deployments/chipnet.json` from `npm run demo:deploy`.

**Local preview:** open http://localhost:3000/?preview to try the whole flow with no wallet and no network. It runs a throwaway test chain inside the page (mem-cash) with a demo loan and a test wallet, plus buttons that play the price feed, miners and a keeper. It is labelled as a preview on screen. `npm run web:e2e` drives it in a headless browser, on desktop and phone sizes.

```bash
npm run web:build
```

This writes the static site to `web/out/`, which you can host anywhere. It reads `deployment.json` next to `index.html` at runtime.

## Run the demo on chipnet

> **DEMO ORACLE.** On chipnet the price comes from a demo oracle key that we control, so the price can be made to fall on camera. The messages use the real General Protocols format and go through Paryon's real price contract, which checks them with `checkDataSig`. Mainnet would use General Protocols' oracle key (`02d09db0…fd2818`) instead.

These steps need a normal internet connection (Electrum over WebSocket). Run them on your own machine.

1. Create demo keys in `.env` (git ignores it):

   ```bash
   npm run demo:keys -- --write
   ```

2. Fund the two addresses it prints from the chipnet faucet at https://chipnet.bch.ninja/: about 1.2 tBCH for the funder and 0.6 tBCH for the borrower.

3. Deploy Paryon's add-collateral contracts with two demo loans (0.5 BCH collateral, $115 debt each, at $300/BCH, so 130%):

   ```bash
   npm run demo:deploy
   ```

   This writes `deployments/chipnet.json`. Add `--borrower-address <bchtest:...>` to send the loan keys to a Cashonize wallet instead of the demo borrower.

4. Set up a vault for demo loan 0 with a 0.5 BCH reserve. It rescues below 125%, lifts to at most 150%, with a 1-block cooldown:

   ```bash
   npm run demo:setup -- --loan 0 --reserve 0.5
   ```

   Wait for one block (about 10 minutes) so the reserve is past its cooldown.

5. Start the keeper in another terminal:

   ```bash
   npm run keeper -- --watch --interval 20
   ```

6. Crash the price. At $265 the loan drops to 115%:

   ```bash
   npm run demo:crash -- --price 265
   ```

7. Watch the keeper rescue the loan, then check:

   ```bash
   npm run demo:status
   ```

8. Withdraw everything back to the borrower:

   ```bash
   npm run demo:withdraw
   ```

Transactions link to https://chipnet.imaginary.cash. The demo deployment is **not Paryon's**: it runs Paryon's unmodified Loan, LoanSidecar, manage and PriceContractGuarded bytecode under our own token categories. Its demo loans are created directly in the deployment transaction rather than through Paryon's `borrow`. Borrowing, the stability pool and liquidation are not deployed. The demo price contract's migration-key category is a hash of a sentence, so no migration key exists for it.

`test/demo.test.ts` runs this whole sequence on the mem-cash node.

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

- **Cooldown:** the script checks the cooldown the rescue declares as its relative timelock, and the node enforces the reserve's real age (BIP68). `test/node.test.ts` shows the node refusing an early rescue and the keeper waiting it out.
- **Price staleness:** the rescue uses whatever Paryon's price contract holds. If nobody updates it, no rescue happens, and no liquidation happens either. With several price threads, a keeper can choose the most out-of-date one. The target ratio, the cooldown, and the fact that the money goes into the borrower's own loan limit what that can achieve.
- **Trust in Paryon:** Paryon's team can migrate the price contract code (`contract_overview.md:539`). Backstop requires the price contract output to come back unchanged, but a migrated contract could still report a wrong price. Every Paryon user already carries this risk.
- **Demo setup on chipnet:** there is no public Paryon deployment on chipnet. The demo will deploy Paryon's unmodified add-collateral contracts with our own token categories and a clearly labelled demo oracle key. See `docs/PHASE0.md`.

## Layout

```
contracts/   Backstop.cash, compiled artifact, shared TypeScript helpers (@backstop/contracts)
keeper/      stateless keeper CLI (@backstop/keeper)
web/         static web app (Next.js, WalletConnect)
oracle-demo/ DEMO ONLY: demo oracle, chipnet deployment and demo scripts (@backstop/demo)
deployments/ where the demo deployment lives on chipnet (written by demo:deploy)
test/        Vitest suite on MockNetworkProvider and mem-cash
docs/        research and design notes
```
