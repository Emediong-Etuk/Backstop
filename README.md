# Backstop

**A pre-funded rescue for ParyonUSD loans on Bitcoin Cash.** BCH BLAZE 2026 entry.

A ParyonUSD borrower locks BCH and borrows PUSD. If the loan falls below 110% collateral it is liquidated, and the borrower loses all of that BCH. Today the only defence is to watch the price and add collateral by hand.

With Backstop, the borrower moves their loan key and a BCH reserve into a vault, once. If BCH falls far enough that the loan nears liquidation, **anyone** can broadcast a rescue that moves part of the reserve into the borrower's own loan.

- **Safety enforced on-chain.** Every guarantee is a `require` in `contracts/Backstop.cash`. A malicious keeper building the transaction by hand can only perform the rescue correctly.
- **BCH-native.** The pieces are a CashScript covenant, CashTokens (Paryon's minting loan-key NFT), transaction introspection, and oracle prices verified in script with `checkDataSig` (in Paryon's price contract, which the rescue reads). There is no backend, database or custodial server.
- **No friction.** One signature to set up, none during a rescue, one to withdraw. No account. The rescue's fee comes from the reserve, within a cap the borrower sets.

Docs: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (technical walkthrough, guarantee → `require` → test), [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) (the two-minute pitch), [`docs/PHASE0.md`](docs/PHASE0.md) (research on Paryon, the oracle and XO).

## Quick start from a clean clone

Requires Node 22+.

```bash
npm install
```

```bash
npm test
```

`npm test` compiles the covenant and runs 99 tests. They use **Paryon's real compiled contracts** (`@paryonusd/contracts@1.1.0`), on two networks:

- CashScript's mock network;
- `@paryonusd/mem-cash`, an in-memory node that checks relative timelocks, standardness and fees the way BCHN does.

Try the app without a wallet or network:

```bash
npm run web:dev
```

Then open http://localhost:3000/?preview. This **local preview** runs a throwaway test chain inside the page, with a demo loan, a test wallet and buttons that play the price feed, the miners and a keeper. The same flow runs headless on desktop and phone sizes with `npm run web:e2e`; that needs Playwright with Chromium.

## How it works

The vault is two outputs at one `Backstop.cash` address:

- a **key UTXO**: 1000 sats plus the loan's minting loan key;
- a **reserve UTXO**: BCH only.

They are separate because Paryon requires the loan key to come back with exactly the value it went in with (`manage.cash:121`).

A rescue is Paryon's own add-collateral transaction (`manage` with no repayment), with the vault at inputs 4 and 5:

```
in 0  Paryon price contract     out 0  price contract, unchanged
in 1  Paryon loan               out 1  loan, same state, collateral + top-up
in 2  Paryon loan sidecar       out 2  sidecar, unchanged
in 3  Paryon manage function    out 3  manage function, unchanged
in 4  vault key                 out 4  vault key, unchanged
in 5  vault reserve             out 5  vault reserve, minus top-up and capped overhead
                                out 6  optional keeper reward (BCH only)
```

The rescue reads the price from Paryon's price contract at input 0. That contract accepts only oracle-signed, newer prices. So the rescue triggers on exactly the price Paryon would liquidate at, and an old low price cannot be replayed.

## Threat model

| Party | Can | Cannot (enforced by) |
|---|---|---|
| **Keeper** (anyone) | Broadcast a rescue while the loan is below the trigger; take a reward within the fee cap | Steal or copy the loan key, withdraw collateral, raise debt, change the interest manager, top up another loan, overfund past the target, drain the reserve with tiny rescues, rescue before the cooldown. All by `Backstop.cash` `require`s; see [ARCHITECTURE.md](docs/ARCHITECTURE.md#every-guarantee-is-a-require) |
| **Web app / frontend** | Build transactions for the wallet to sign | Move funds without the borrower's signature. A malicious frontend could ask the borrower to sign a bad setup or withdraw, like any dapp; once funds are in the vault, the covenant decides. The site is static, holds no keys and stores nothing. |
| **Borrower** | Withdraw the key and the whole reserve at any time with one signature | — |
| **Anyone else** | Nothing beyond what a keeper can do | Withdraw from the vault (`ownerSpend` checks the owner's key hash and signature; `ownerWithdraw` needs one of the owner's own coins, signed by the owner, and pays only the owner's address) |
| **Oracle** | Sign prices. A wrong price triggers (or withholds) a rescue, exactly as it would trigger (or withhold) a liquidation | Move funds anywhere but into the borrower's own loan |
| **Paryon team** (migration key) | Migrate the price contract code, as for every Paryon user | Take vault funds; Backstop pins the price contract's output unchanged |
| **Miners** | Delay or reorder transactions | Change what a rescue may do |

Residual risks:

- **A stale price.** No rescue happens, but no liquidation happens either.
- **A keeper choosing the most out-of-date of several price threads.** Limited by the target ratio, the cooldown, and the fact that money goes only into the borrower's own loan.
- **A crash faster than any keeper, or within the cooldown.** The stability pool can still liquidate first.
- **Redemptions**, which are out of scope.

## What is mocked, demo-only or unfinished

- **No public Paryon chipnet deployment exists.** The demo deploys Paryon's **unmodified** Loan, LoanSidecar, manage and PriceContractGuarded bytecode under our own token categories (`oracle-demo/src/deploy.ts`). Demo loans are created directly at genesis, not through Paryon's `borrow`. Borrowing, the stability pool and liquidation are not deployed.
- **The price on chipnet comes from a DEMO oracle key** that we control, so the price can fall on camera. The messages use the real General Protocols format and go through Paryon's real price contract and `checkDataSig`. On mainnet the price contract uses General Protocols' key `02d09db08af1ff4e8453919cc866a4be427d7bfe18f2c05e5444c196fcf6fd2818`. The web app labels the demo price feed.
- **Keeper discovery reads setup transaction IDs from `keeper/vaults.json`**, not a ChainGraph query. I could not confirm a chipnet ChainGraph instance. Each vault's rules still come from its on-chain setup OP_RETURN.
- **Not yet run on chipnet itself.** The development sandbox could not reach chipnet. Everything was exercised on the mock network and on mem-cash, including the full demo sequence (`test/demo.test.ts`) and the web app in a browser (`npm run web:e2e`).
- **WalletConnect signing with Cashonize is untested.** Setup and withdraw both ask the wallet to sign only its own coins: withdraw uses `ownerWithdraw`, so no placeholder signatures are involved.
- **WizardConnect is tested against the WizardConnect libraries, not a real wallet app.** `test/wizardconnect.test.ts` pairs the web app's code with `@wizardconnect/wallet`'s real connection manager over a local Nostr relay and runs setup, rescue and withdraw. The test wallet signs the way the protocol requires, but no shipping WizardConnect wallet has been tried yet.
- **The XO template is checked offline only.** XO's own parser and compiler show it produces Backstop's and Paryon's exact bytecode (`test/xo.test.ts`), but it has not been run in the XO engine or debug tool; see [`xo/README.md`](xo/README.md).
- **One loan per vault.** Topping up the reserve means withdrawing and setting up again.

## Run the demo on chipnet

These steps need a normal internet connection (Electrum over WebSocket). The recording sequence is in [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md).

**Check the chipnet servers first.** A server whose node has fallen off the network keeps answering, but no new block arrives there and nothing sent through it confirms. Compare the servers:

```bash
npm run demo:servers
```

Then put a server that is on the newest block in `.env` as `CHIPNET_ELECTRUM_SERVER`. The demo scripts, the keeper and the web app all use it. Fund your addresses from a faucet whose node is on the same chain. On 12 November 2026 the `chipnet.bch.ninja` server and faucet were stuck at block 331,985 while chipnet was past 332,075.

1. Create demo keys in `.env`, which git ignores:

   ```bash
   npm run demo:keys -- --write
   ```

2. Fund the printed addresses from https://chipnet.bch.ninja/: about 1.2 tBCH for the funder and 0.6 tBCH for the borrower.

3. Deploy Paryon's add-collateral contracts with two demo loans (0.5 BCH collateral, $115 debt, at $300/BCH, so 130%). Add `--borrower-address <bchtest:z…>` to send the loan keys to a Cashonize wallet.

   ```bash
   npm run demo:deploy
   ```

4. Either set up through the web app (`npm run web:dev`, with `NEXT_PUBLIC_WC_PROJECT_ID` in `.env`), or with the scripted borrower:

   ```bash
   npm run demo:setup -- --loan 0 --reserve 0.5
   ```

   Then wait one block for the cooldown.

5. Start the keeper in another terminal:

   ```bash
   npm run keeper -- --watch --interval 15
   ```

6. Crash the price, then check status and withdraw:

   ```bash
   npm run demo:crash -- --price 265
   ```

   ```bash
   npm run demo:status
   ```

   ```bash
   npm run demo:withdraw
   ```

7. Print the transactions as a Markdown table for `docs/ARCHITECTURE.md`:

   ```bash
   npm run demo:links
   ```

`deployments/chipnet.json` holds no secrets; commit it so the web app and others can find the deployment.

## Keeper

```bash
npm run keeper -- --dry-run
```

```bash
npm run keeper -- --watch
```

The keeper is stateless. It needs no private key and no funds. `--dry-run` prints the rescue it would send (inputs, outputs, ratio before and after, raw hex) and broadcasts nothing. It checks each transaction locally before broadcasting and waits out each vault's cooldown. Options: `--fee-rate`, `--reward-sats`, `--server` (default: `CHIPNET_ELECTRUM_SERVER` from `.env`), `--deployment`, `--vaults`. Set `KEEPER_REWARD_ADDRESS` in `.env` to collect rewards.

## Web app

A static Next.js site (`web/`), with three screens. With WizardConnect, the app reads the wallet's receive and change addresses from its xpubs and finds the used ones from chain history; it then tells the wallet which key signs each input.

- **Connect:** WizardConnect (HD wallets, no setup needed) or WalletConnect (chain `bch:bchtest`, for wallets such as Cashonize).
- **Set up:** finds the loan whose key is in the wallet, shows its health and liquidation price, and explains what a rescue will do. One signature.
- **Status:** reserve, rescue and liquidation prices, rescue history from the chain, and *Withdraw everything*.

To build the site:

```bash
npm run web:build
```

This writes `web/out/`, which you can host anywhere. It reads `deployment.json` next to `index.html` at runtime. Configuration is in `.env` (see `.env.example`): `NEXT_PUBLIC_WC_PROJECT_ID` (free from https://dashboard.reown.com) and optionally `CHIPNET_ELECTRUM_SERVER`.

## XO template

`xo/backstop.template.json` expresses the vault's three actions (protect, rescue, withdraw) as an XO template for the XO debug tool. It is generated from the compiled contracts with `npm run xo:export`; `npm run xo:values -- <setup txid>` prints a real vault's values for it. Details and limits: [`xo/README.md`](xo/README.md).

## Repository layout

```
contracts/    Backstop.cash, compiled artifact, shared TypeScript helpers (@backstop/contracts)
keeper/       stateless keeper CLI (@backstop/keeper)
oracle-demo/  DEMO ONLY: demo oracle, chipnet deployment, demo scripts, local chain (@backstop/demo)
web/          static web app (Next.js, WalletConnect, local preview)
xo/           the vault as an XO template (backstop.template.json) for the XO debug tool
test/         Vitest suite on the mock network and mem-cash
deployments/  where the demo deployment lives on chipnet (written by demo:deploy)
docs/         research, architecture, demo script; docs/phase0/probe is the composition probe
```

No private keys are committed. Keys live in `.env`; see `.env.example`.

WizardConnect support uses `@wizardconnect/core` and `@wizardconnect/dapp` (LGPL-3.0) as unmodified npm dependencies.
