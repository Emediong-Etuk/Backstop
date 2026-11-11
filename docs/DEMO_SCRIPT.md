# Demo script: two-minute pitch

Three windows on screen: the **web app** (left), the **keeper** terminal (top right) and a **command** terminal (bottom right). Cashonize is open on your phone or in another tab.

## Before you record (about 30 minutes, once)

1. Keys and coins:

   ```bash
   npm run demo:keys -- --write
   ```

   Fund the printed funder address with about 1.2 tBCH from https://chipnet.bch.ninja/.

2. In Cashonize (chipnet), copy your wallet's token-aware address (`bchtest:z…`) and fund it with about 0.6 tBCH from the faucet.

3. Deploy, sending the demo loan keys to your Cashonize wallet:

   ```bash
   npm run demo:deploy -- --borrower-address <your bchtest:z… address>
   ```

4. Put your WalletConnect project ID in `.env` (`NEXT_PUBLIC_WC_PROJECT_ID=…`), then start the app:

   ```bash
   npm run web:dev
   ```

5. Do one full practice run of the live part below. When recording, pick the untouched loan (0.50 BCH collateral) in the app's loan picker; the practised one has extra collateral from its rescue.

6. Check the price is back at $300 before recording:

   ```bash
   npm run demo:crash -- --price 300
   ```

**Cooldown:** a vault can only be rescued once its reserve is one block old (about 10 minutes, with the 10-minute setting). So record the setup, pause the recording until the next block, then record the crash. Say it on camera; it is one of the protections.

## The script

**0:00 – 0:20 — Who and the problem** (face or title card)

> "Meet a borrower on ParyonUSD, the Bitcoin Cash stablecoin. She locked half a BCH and borrowed 115 dollars. If BCH drops until her loan is under 110% collateral, it gets liquidated and she loses all of that BCH. Prices crash at 3am. Today her only defence is to be awake, watching, with spare BCH ready to add by hand."

**0:20 – 0:35 — What Backstop is** (web app, connect screen)

> "Backstop is a safety net. She sets aside a BCH reserve once. If her loan nears liquidation, anyone, a keeper bot or a stranger, can move part of that reserve into her loan. She doesn't sign anything. And the contract makes sure that's the only thing they can do with it."

Click **Connect wallet**, approve in Cashonize.

**0:35 – 0:55 — Set up, one signature**

- The app shows *Your loan*: 0.50 BCH, $115 borrowed, health 130%, liquidated below $253.
- Set the reserve to **0.5**. Open **More settings** and set *Time between rescues* to **about 10 minutes**.
- Point at the green summary:

  > "If BCH falls below $287.50, up to 0.25 BCH moves in and brings the loan back to 150%. Fees are capped at 0.0001 BCH, paid from the reserve."

- Click **Protect my loan** and approve once in Cashonize. The app shows *Your loan is protected*.

*(Pause recording until the next block.)*

**0:55 – 1:25 — The crash and the rescue** (terminals)

Keeper terminal, already running:

```bash
npm run keeper -- --watch --interval 15
```

> "This is a keeper. It has no keys and no money. It reads the vault's rules straight from the chain."

Command terminal:

```bash
npm run demo:crash -- --price 265
```

> "That's our demo price feed, in the real oracle message format, dropping BCH to $265. Her loan is now at 115%, five points from liquidation."

The web app switches to *Your loan is below your rescue level*. Within 15 seconds the keeper prints `RESCUED: added … BCH to the loan`. The app returns to *Your loan is protected*, health back near 150%, and the history shows **Rescued**.

> "She was asleep. Nothing to sign, no spare BCH. The fee came out of the reserve, under the cap she set."

**1:25 – 1:40 — Withdraw, one signature**

Click **Withdraw everything**, confirm, approve in Cashonize.

> "And she can always leave. One signature, key and reserve back. Nobody else can take them."

**1:40 – 2:00 — Why it's safe** (architecture diagram or `Backstop.cash`)

> "Every guarantee is a `require` in the covenant. A rescue must be Paryon's own add-collateral transaction. The key comes straight back, the loan's debt can't change, no extra outputs, fees capped. The price comes from Paryon's on-chain price contract, verified with `checkDataSig`, so there's no replay. Our tests run every attack twice, once against Paryon's real contracts and once with Paryon's checks removed, so the protection is Backstop's own. No server, no database, no account. Backstop."

## If something goes wrong on the day

- **Chipnet or WalletConnect is down:** open `http://localhost:3000/?preview` and use its buttons (*Price to $265*, *Run a keeper*). It is labelled as a local preview on screen.
- **The keeper says "reserve is in its cooldown":** wait for the next block.
- **The keeper says "rescue would be too small":** the price is too close to the trigger. Crash a bit lower, e.g. `--price 255`.
