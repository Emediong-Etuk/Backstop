# Backstop — Phase 0 research report

Date: 2026-11-10. Status: **research complete, waiting for your go-ahead before any contract code.**

## TL;DR

1. **Composition works.** Paryon's add-collateral path (`manage`) does not pin input or output counts beyond index 4, does not care what script holds the loan key, and leaves input 5 and outputs 5+ free. I confirmed this by running Paryon's *real compiled bytecode* (`@paryonusd/contracts@1.1.0`) on CashScript's `MockNetworkProvider` with the loan key in a P2SH32 covenant, a reserve input at index 5, a reserve-change output, a keeper output and an OP_RETURN. It validated (see [the probe](#the-probe)).
2. **The single-UTXO vault in the brief cannot work.** Paryon requires the output that returns the loan key to carry *exactly* the same BCH value as the input (`manage.cash:121`). If the key UTXO also held the reserve, the reserve could never shrink. **The vault has to be two UTXOs at the same Backstop address:** a key UTXO (1000 sats + loan key) at input 4 and a reserve UTXO (BCH only) at input 5. The probe shows the single-UTXO version being rejected by that exact line.
3. **The loan key is a *minting* NFT** (`Borrowing.cash:108`, `contract_overview.md:446`). Any transaction that spends it can mint more loan keys. Without Backstop's checks, the probe accepted a keeper minting a second loan key to their own address (full, permanent control of the loan). It also accepted a keeper withdrawing collateral and changing the loan's interest-manager settings. Backstop must forbid token-carrying outputs beyond the pinned ones and pin the loan's commitment byte for byte.
4. **A better price source exists.** The add-collateral transaction *already* includes Paryon's on-chain PriceContract at input 0 (`manage.cash:35-36, 72-73`). That contract checks the oracle signature with `checkDataSig` and only accepts strictly newer oracle sequence numbers (`PriceContract.cash:46, 77`). If Backstop reads its price from there, **an old price cannot be replayed** and the rescue triggers on exactly the price Paryon would liquidate at. I recommend this over a raw oracle message in the rescue (decision needed: [Q1](#decisions-i-need-from-you)).
5. **No public Paryon chipnet deployment found** in any source I could reach. The contracts repo, the docs in it and npm have no chipnet addresses or token IDs. Recommendation: **Plan B, first option.** Deploy Paryon's own audited contracts for the add-collateral path (PriceContractGuarded, Loan, LoanSidecar, manage) to chipnet ourselves, unmodified, with our own token categories and a demo oracle key. This looks like well under a day and needs no `MockLoan.cash`.
6. **Network limits in this sandbox:** paryonusd.com, bchblaze.cash, blaze.xo.cash, dorahacks.io, oracles.generalprotocols.com, ChainGraph and the chipnet Electrum servers are all unreachable from here (DNS / proxy 403). GitHub, GitLab and npm work. Everything below comes from those sources. Items I could not check are marked **UNVERIFIED**.

---

## Sources actually read

| Source | Version / commit |
|---|---|
| `github.com/ParyonUSD/contracts` (`ParityUSD/contracts` redirects to the same repo) | `67e4b16` (2026-10-08), package `@paryonusd/contracts@1.1.0` |
| `@paryonusd/contracts` compiled artifacts on npm | 1.1.0 |
| `gitlab.com/GeneralProtocols/priceoracle/specification` README | HEAD |
| `gitlab.com/GeneralProtocols/priceoracle/library` (`@generalprotocols/price-oracle@4.0.0`) | HEAD |
| `gitlab.com/GeneralProtocols/xo/templates` (`@xo-cash/templates@0.0.12`) | `b78f1fc` |
| `@xo-cash/engine@0.1.0-next.17612568780` (npm tarball) | — |
| `cashscript` / `cashc` | 0.14.0 (latest) |

Not reachable: the Paryon docs site, the hackathon site and bounty page, the XO debug tool, the live oracle REST API. The Paryon test suite and TypeScript library (`paryon_testing_suite`, `paryon_library`, both named in the contracts README) are private or not published: cloning them asks for credentials. I found no Paryon library on npm. `@paryonusd/mem-cash` exists (more on it below).

File references below are relative to the Paryon contracts repo unless noted.

---

## Q1. Exact transaction layout for adding collateral

There is no separate "add collateral" function. Adding collateral is `manage(repayAmount = 0, interestManagerConfiguration)` with a larger output-1 value. Layout from `contracts/loan/loanContractFunctions/manage.cash:21-23`:

```
Inputs:  00-pricecontract, 01-loan, 02-loanTokenSidecar, 03-manageLoan, 04-loanKey, 05-userBch, ?06-repayTokens
Outputs: 00-pricecontract, 01-loan, 02-loanTokenSidecar, 03-manageLoan, 04-loanKey, ?05-opreturn, ??-changeTokens, ??-changeBch
```

What each contract requires:

| Input | Contract (function) | Requires |
|---|---|---|
| 0 | `PriceContract(Guarded).sharePrice` | Output at *its own index* recreated with the same bytecode, category and commitment, 1000 sats and 0 FT (`PriceContract.cash:90-99`). The Guarded version adds checks that only run when a *Borrowing* contract is at input 0 (`PriceContractGuarded.cash:106`), so they don't affect us. |
| 1 | `Loan.interact` | Input 2 is the outpoint right after the loan's own outpoint (the sidecar) (`Loan.cash:29-31`). Input 3 has category `paryonTokenId` (immutable) and a 1-byte commitment (`Loan.cash:35-39`). **It does not check input 3's locking bytecode** (`Loan.cash:40-41`, `contract_overview.md:543`). |
| 2 | `LoanTokenSidecar.attach` | Input 1 is the outpoint right before it. If output 1 has the loan's category, the sidecar is recreated at output 2 with 1000 sats (`LoanSidecar.cash:13-25`). |
| 3 | `manageLoan.manage` | Must be at input 3 (`:31`). Input 0 category is `paryonTokenId+0x01` and its commitment starts `0x00` (`:35-36`). Input 1 category is `paryonTokenId+0x01` (`:39`). Input 4 category is `loanTokenId+0x02`, i.e. the minting loan key, where `loanTokenId` is read from input 2 (`:42-45`). `repayAmount` is 0, ≥ 100.00, or the full redeemable debt (`:66-69`). After the change the loan still needs ≥ 110% collateral: `newDebt ≤ (newCollateral·10/11)·price/1e8` (`:95-99`). Output 1 keeps the same bytecode and category, 0 FT, and commitment `0x01 + newDebt(6) + bytes 7..21 unchanged + interestManagerConfiguration(5)` (`:108-115`). **Output 4 keeps the same bytecode, category, commitment and value as input 4** (`:118-121`). The function NFT is recreated at output 3 with 1000 sats (`:125-129`). If `repayAmount > 0`, the PUSD is burned at output 5 (`:131-139`). |
| 4 | the loan key | Whatever its own locking script requires. Paryon adds nothing beyond `:45` and `:118-121`. |
| 5+ | user BCH | Not inspected by any Paryon contract. |

`manage` also has a close-loan variant (full repayment) with a different output layout (`:23, 82, 141-146`). Backstop blocks it by requiring output 1 to be the loan with an unchanged commitment.

## Q2. Where the key sits, and can it live in a P2SH32 covenant with BCH?

- The key must be at **input 4** and return at **output 4** with the **same locking bytecode, category, commitment and value** (`manage.cash:45, 118-121`).
- Paryon does **not** assume P2PKH. It never checks a signature from the key holder: owning the key means being able to spend its UTXO, so a P2SH32 covenant can hold it. `contract_overview.md:446` names this case: "authorized access from another contract". The probe confirms it.
- **It cannot also carry the reserve** because of the value-equality rule at `manage.cash:121` (probe: rejected, failing exactly that line). Hence the two-UTXO vault.
- The key is a **minting** NFT with an empty commitment and 1000 sats (`Borrowing.cash:107-111`). Minting capability lets the spending transaction create any number of NFTs of the loan-key category, including new minting keys (`contract_overview.md:446`). The probe confirms a keeper could do this if Backstop didn't stop it.

## Q3. Room for an extra covenant input, a keeper output and an OP_RETURN?

Yes. `manage` puts no limit on input or output counts. Input 5+ and output 5+ are free except for the output-5 burn, which only applies when `repayAmount > 0`, and we force that to 0. Paryon's own docs say this is deliberate: "The Paryon contracts do not lock down the users inputs and outputs, this is to allow for flexibility … and to enable modular contract interactions" (`contract_overview.md:531`).

Proposed rescue layout (validated in the probe, about 1.5 KB):

```
in 0  Paryon PriceContract (sharePrice)     out 0  PriceContract, unchanged
in 1  Paryon Loan                           out 1  Loan, same commitment, value + topUp
in 2  Paryon LoanSidecar                    out 2  LoanSidecar, unchanged
in 3  Paryon manage function                out 3  manage function, unchanged
in 4  Backstop vault: key UTXO              out 4  Backstop vault: key UTXO, unchanged
in 5  Backstop vault: reserve UTXO          out 5  Backstop vault: reserve UTXO, value ≥ in5 − topUp − maxOverhead
                                            out 6  (optional) keeper reward, BCH only
```

Rescue transactions need no OP_RETURN, so Backstop caps outputs at 7. The OP_RETURN with vault parameters goes in the **setup** transaction.

## Q4. Loan state layout, units, decimals

`Loan.cash:9-20`, 27 bytes, all integers little-endian:

| Bytes | Field |
|---|---|
| 0 | identifier `0x01` |
| 1–6 | `borrowedTokenAmount`: debt in PUSD base units |
| 7–12 | `amountBeingRedeemed` |
| 13 | `status` (`0x00` new, `0x01` single period, `0x02` mature) |
| 14–17 | `lastPeriodInterestPaid` |
| 18–19 | `currentInterestRate` |
| 20–21 | `nextInterestRate` |
| 22 | `interestManager` |
| 23–24 | `minRateManager` |
| 25–26 | `maxRateManager` |

- **Debt** is read from bytes 1–6 (`manage.cash:49-55`).
- **Collateral** is not in the state. It is the loan UTXO's BCH value in satoshis (`manage.cash:95, 103`; `liquidate.cash:57`).
- **PUSD has 2 decimals.** The minimum debt is written `100_00` and documented as "100.00 ParyonUSD" (`manage.cash:11-12, 92`; `Borrowing.cash:12, 56`). So debt is in **US cents**.
- **Price unit:** the PriceContract stores the oracle's 4-byte price at commitment bytes 5–8 (`PriceContract.cash:8-13, 80`; read at `manage.cash:72`). It is compared as `debtCents ≤ collateralSats·10/11·price/1e8` (`manage.cash:97-99`), so the price must be **US cents per BCH**. This matches the oracle library's description of the price as "units per Bitcoin Cash" (`oracle-lib lib/data.ts:177`) with ATTESTATION_SCALING = 100. **UNVERIFIED live:** I couldn't fetch the oracle's scaling metadata (API blocked), so this rests on Paryon's arithmetic.
- **Liquidation rule:** a loan is liquidatable when `debt > (collateral·10/11)·price/1e8` (`liquidate.cash:57-63`). The stability pool repays the debt and takes **all** the collateral (`liquidate.cash:3-5`). Your formula (liquidation price = debt / collateral × 1.1) is correct, apart from integer rounding.

## Q5. Does adding collateral change any state field?

**No.** With `repayAmount = 0`, `manage` rebuilds the commitment from the same debt, the same bytes 7–21 and the `interestManagerConfiguration` the caller passes in (`manage.cash:108-109`). It does not accrue interest or touch timestamps. **But the caller picks the last 5 bytes.** A keeper could pass a different `interestManagerConfiguration` and appoint themselves interest manager (probe: accepted). Backstop must require `out[1].nftCommitment == in[1].nftCommitment`. That one check also forces `repayAmount == 0`, because the debt bytes must stay the same.

Related: anyone can run `payInterest` once per period (~144 blocks). It deducts interest from the collateral and rewrites the status, period and rate fields (`payInterest.cash:74-89`). So the loan commitment changes about once a day, and Backstop has to read the loan state live rather than store it at setup. `manage` does not require interest to be up to date.

## Q6. Public chipnet deployment?

**None found.** No file in the contracts repo mentions chipnet or testnet. The only deployment config in the docs is mainnet (`contract_overview.md:73-79, 465-471`; mainnet `paryonTokenId 9b560c75…dc0ea`). npm has no deployment package. **UNVERIFIED:** the docs site and app were unreachable, so if you know of a chipnet app, tell me and I'll switch to Plan A.

What we can do instead (feasibility checked in the probe): **deploy the four Paryon contracts the add-collateral path needs, unmodified, from `@paryonusd/contracts`.**

- None of Loan, LoanSidecar or manage takes constructor arguments. PriceContractGuarded takes `(oraclePublicKey, migrationKeyCategory)`. We pass the **demo oracle** key and a dummy migration category.
- Each new token category comes from spending an output at index 0 (a "genesis" input). One chipnet transaction with two genesis inputs can create both categories at once. Its outputs: price-contract mutable NFT, loan mutable NFT with a hand-written commitment, sidecar NFT `0x01` *at the next output index* (Loan requires this adjacency), manage function NFT `0x02`, and the minting loan key sent to the demo borrower's wallet.
- What this skips: `Borrowing`, the loan-key factory, the stability pool and liquidation. The demo loan is created by that genesis transaction, not by `borrow`. The README and UI must say this plainly. The add-collateral transaction itself runs Paryon's audited bytecode exactly as on mainnet. Contract addresses and categories become configuration, so mainnet would only need different values.

Also useful: `@paryonusd/mem-cash@0.1.0`, an "in-memory Bitcoin Cash node with a Fulcrum-compatible Electrum server, for simulated-network tests". It is a fallback for a fully local end-to-end demo if chipnet stays unreachable.

## Q7. Oracle message layout, price unit, public key

> **Update (Phase 2):** verified against the live oracle API once the session's network allowed it. The latest message `53a3f36a47501d002a501d00de590000` decodes to timestamp 2026-11-10 23:05:55 UTC, message sequence 1921095, data sequence 1921066, price 23006, so $230.06 per BCH. Its signature verifies as Schnorr over `sha256(message)` under `02d09db0…fd2818`, which is the check `checkDataSig` performs. Metadata messages from the same key: `-1 OPERATOR_NAME` "General Protocols", `-6 ATTESTATION_SCALING` "100", `-53` "US Dollar", `-57` "BCH". **Price unit confirmed: US cents per BCH.**

From the spec (`priceoracle/specification README.md:97-109`), "All numbers are little-endian signed integers":

| Bytes | Field |
|---|---|
| 0–3 | message timestamp (unix seconds, UTC) |
| 4–7 | message sequence (across all of this oracle's messages) |
| 8–11 | data sequence (across price messages only; negative means metadata, 0 means notification) |
| 12–15 | price |

- **Signature:** Schnorr over `sha256(message)` (oracle library `lib/data.ts:526-545`). That is what `checkDataSig` verifies, and Paryon uses it at `PriceContract.cash:46`.
- **Price unit:** US cents per BCH (see Q4). The spec's scaling metadata type is `-6 ATTESTATION_SCALING` (`README.md:326`). **UNVERIFIED live.**
- **General Protocols BCH/USD public key:** `02d09db08af1ff4e8453919cc866a4be427d7bfe18f2c05e5444c196fcf6fd2818`. Two primary sources agree: Paryon's deployment parameters (`contract_overview.md:466`) and the spec's REST example (`README.md:189`). **UNVERIFIED live:** I couldn't fetch a current signed message to check.
- **Which messages Paryon accepts:** only data sequences that are multiples of 10 (the 10-minute heartbeat) or moves of at least 0.5%, and only if strictly newer than the stored sequence (`PriceContract.cash:56-77`). Our demo oracle must follow these rules so its messages reach the price contract.

## Q8. What an XO template looks like, and the effort

An XO template is a TypeScript object typed `XOTemplate` (`@xo-cash/types`) that extends the libauth wallet-template v0 schema (`xo/templates source/faucet_cash.ts`). It has:

- `roles`
- `actions`: each with role requirements and the variables each role must supply
- `transactions`: input and output slots by index
- `inputs` / `outputs`: value, token, sequence number, unlocking script
- `lockingScripts`: P2SH32, or `p2s` for raw scripts
- `scripts`: CashAssembly, with `<var>` and `$()` evaluation
- `constants` and `variables`

Contracts appear as raw CashAssembly in `scripts`. The faucet and wrapped-cash examples are small hand-written covenants. The engine's README shows `Engine.create(mnemonic, { network: chipnet })` → `importTemplate` → `createInvitation`. `@xo-cash/engine` has `0.1.0-next.*` builds (latest `0.1.0-next.17612568780`); the `next` tag now points to `0.1.1-next.17778370827`.

Effort: CashScript can output Backstop's bytecode as CashAssembly, so `ownerSpend` and setup are one action each with an `owner` role. That part is about half a day. The rescue is harder: the template must also describe the four Paryon inputs and their unlocking data, and a `keeper`/`service` role has to supply those UTXOs, as the faucet template does. **Estimate 1.5–2 days total. High uncertainty**, because I couldn't read the bounty text, the debug tool or the template docs.

**UNVERIFIED:** the exact "Build with XO" bounty requirements.

**WizardConnect** is on npm as `@wizardconnect/dapp@0.2.2` and `@wizardconnect/react@0.2.3` (riftenlabs, GitLab). I haven't read its API yet. I'll judge in Phase 4 whether it's a small addition.

---

## Corrections to the brief

1. **Single vault UTXO → two vault UTXOs** (key + reserve) at one Backstop address. Cause: `manage.cash:121`.
2. **Constructor parameters change** (proposal below). We need the loan-key category, the Paryon category and the manage function's locking bytecode. Under the price-contract option, `oraclePubKey` and `minMessageTimestamp` leave Backstop.
3. **"8 small function contracts that authenticate each other":** Loan authenticates its function only by category and 1-byte commitment, not by locking script (`Loan.cash:40-41`, `contract_overview.md:543`). Backstop should pin input 3's locking bytecode to `manage` itself.
4. **Compiler:** the contracts now use the CashScript **0.13** language, compiled with `-S -L` to keep the audited bytecode (README "Audit Snapshots"). Six contracts changed after the third audit pass, including `manage` (an extra burn on loan close) and the new `PriceContractGuarded` (`post-audit-changes.md`). Mainnet price contracts moved to PriceContractGuarded on 2026-10-08 (`post-audit-changes.md:92`). We'll use cashc/cashscript **0.14.0** for Backstop and load Paryon's precompiled artifacts. The probe confirms 0.14 runs them.
5. **Trust in Paryon's migration key:** the team's migration key can replace the price contract code at any time (`contract_overview.md:539-546`). Paryon's own docs advise that any contract including the price contract should check its output itself. Backstop will require output 0 to replicate input 0 exactly.

## Proposed design (for your review, not built yet)

`Backstop.cash` constructor:

| Parameter | Purpose |
|---|---|
| `ownerPkh` | borrower |
| `loanKeyCategory` (bytes32) | the one loan this vault protects |
| `paryonTokenId` (bytes32) | authenticates the price contract and loan |
| `manageLockingBytecode` (bytes) | pins input 3 to Paryon's real `manage` |
| `triggerRatioBps`, `targetRatioBps`, `maxTopUpSats`, `maxOverheadSats`, `cooldownBlocks` | as in the brief |
| *(raw-oracle option only)* `oraclePubKey`, `minMessageTimestamp` | as in the brief |

`rescue()` runs on both vault inputs. Each `require` stops a named attack:

- Exactly 6 inputs and at most 7 outputs. Vault inputs at 4 (key) and 5 (reserve, no token), both with this script's bytecode.
- Input 0 has category `paryonTokenId+0x01` and commitment prefix `0x00`. Output 0 replicates input 0 exactly.
- Input 1 has category `paryonTokenId+0x01`. Input 2 has category `loanKeyCategory` (the sidecar of *our* loan). Input 3 has bytecode `manageLockingBytecode`, category `paryonTokenId` and commitment `0x02`.
- Output 1: same bytecode, category and **commitment** as input 1, 0 FT. `topUp = out1.value − in1.value`, with `0 < topUp ≤ maxTopUpSats`.
- Output 2 replicates input 2. Output 4 replicates input 4 (bytecode, category, commitment, value).
- Output 5: this vault's bytecode, no token, value ≥ `in5 − topUp − maxOverheadSats`. Output 6, if present, carries no token. This blocks key copies and keeps user losses ≤ `topUp + maxOverhead`, with `topUp` going into the user's own loan.
- Ratio uses `price` = input 0 commitment bytes 5–8 and `debt` = input 1 bytes 1–6: before < `triggerRatioBps` and after ≤ `targetRatioBps`. Paryon separately requires after ≥ 110%. BCH script integers are now big enough for this arithmetic without overflow.
- Reserve input age ≥ `cooldownBlocks` (relative timelock).

`ownerSpend(pubkey, sig)`: hash and signature check only, on either UTXO. The owner withdraws by spending both in one transaction, signed once in the wallet.

Setup transaction: the user's wallet sends the key and the reserve to the vault and writes an OP_RETURN `"BKSP" | version | params`. One signature.

### Residual risks, with the price-contract option

- The trigger price is whatever Paryon's price contract holds. If nobody updates it, no rescue happens, but no liquidation happens either, because liquidation reads the same price.
- With several price threads, a keeper can pick the most stale one. A rescue can then use a lower price Paryon accepted earlier, still limited by the target ratio and the cooldown, and the money still goes into the user's own loan.
- If the price drops faster than the cooldown allows, a rescue can come too late.
- The migration key can change the price contract code, a risk every Paryon user already carries.
- Updating the price contract is a separate transaction (`updatePrice` needs input 0). On mainnet Paryon's operator does this. In our demo, `demo:crash` submits it.

## Decisions I need from you

- **Q1 — price source.** (a) *Recommended:* read Paryon's PriceContract inside the rescue transaction. There's no replay problem, and the oracle `checkDataSig` still runs on-chain, inside Paryon's `updatePrice`, which `demo:crash` uses. The catch: Backstop itself contains no `checkDataSig`. (b) A raw oracle message with `checkDataSig` in Backstop, as briefed, keeping the replay limits. (c) Both, which costs more script for little gain. If showing `checkDataSig` in Backstop's own code matters for judging, choose (b) or (c).
- **Q2 — Plan B as described:** our own chipnet deployment of the four unmodified Paryon contracts, with the demo loan created at genesis instead of through `borrow`. OK?
- **Q3 — network.** Phase 1 needs only npm and runs here. Phases 2–5 need chipnet Electrum (and ideally ChainGraph and the XO tool), which this sandbox can't reach. Options: I propose adding the specific chipnet hosts to this environment's allowlist when we get there (you approve the prompt). Or you run the chipnet steps locally. Or we demo on `@paryonusd/mem-cash` locally and use chipnet only for the final recording. Also: do you have chipnet tBCH, or a faucet you prefer?
- **Q4 — keeper discovery:** I couldn't confirm a chipnet ChainGraph instance. If none exists, the keeper reads vault parameters from a local JSON file, as you suggested, and the README will say so.

## Recommendation

**Plan B: faithful deployment, not a mock.** Composition works with Paryon's real bytecode. There's no public chipnet deployment I could find. Deploying the four needed Paryon contracts ourselves is small, so `MockLoan.cash` isn't needed. Tests in Phase 1 run Backstop against Paryon's actual compiled `manage`/`Loan`/`LoanSidecar`/`PriceContractGuarded` on `MockNetworkProvider`, so the attack tests (withdraw collateral, change config, mint a key copy, add debt) run against the real contracts.

## The probe

`docs/phase0/probe/` contains the script I ran. It is research only, not Backstop code. It uses a trivial anyone-can-spend `Holder.cash` to stand in for the vault, and it builds the composed add-collateral transaction against `@paryonusd/contracts@1.1.0` on `MockNetworkProvider`. Output from the run:

```
OK composed tx (6 in / 8 out incl OP_RETURN) … size 1474
ACCEPTED: withdraw 0.1 BCH collateral (no Backstop)
ACCEPTED: mint a second minting loan key to attacker (no Backstop)
ACCEPTED: change interest manager config (no Backstop)
REJECTED: single-UTXO vault: key returned with reserve minus top-up
          - Failing statement: require(tx.outputs[4].value == tx.inputs[4].value, ...)
```

The three ACCEPTED lines are the attacks Backstop's `rescue` must block. Each becomes a Phase 1 test.
