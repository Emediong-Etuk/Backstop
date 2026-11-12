// What the app reads and does. Every number comes from the chain; nothing is stored anywhere else.
import { placeholderP2PKHUnlocker, type SpendableUtxo, type TransactionBuilder } from 'cashscript';
import {
  assemble, buildSetup, collateralRatioBps, findOwnedVaults, findRescueUtxos, findWalletLoans, liquidationPriceCents, parseLoanState,
  parsePriceState, priceAtRatio, setupParts, vaultContract, vaultHistory, withdrawWithWalletCoinParts,
  type BackstopParams, type Vault, type VaultEvent, type WalletLoan,
} from '@backstop/contracts';
import type { Chain } from './chain';
import { addressForLockingBytecode, type InputSigners, type WalletSession } from './wallet';

export interface LoanView {
  loanKeyCategory: string;
  collateralSats: bigint;
  debtCents: bigint;
  ratioBps: bigint;
  liquidationPriceCents: bigint;
  source: WalletLoan;
}

export interface VaultView {
  vault: Vault;
  /** Undefined once the vault has been emptied. */
  loan?: { collateralSats: bigint; debtCents: bigint; ratioBps: bigint; liquidationPriceCents: bigint; triggerPriceCents: bigint };
  reserveSats: bigint;
  events: VaultEvent[];
  active: boolean;
}

export interface Position {
  priceCents: bigint;
  walletBchSats: bigint;
  loans: LoanView[];
  vaults: VaultView[];
}

export async function currentPriceCents(chain: Chain): Promise<bigint> {
  const threads = (await chain.provider.getUtxosForLockingBytecode(chain.paryon.price.lockingBytecode))
    .filter((u) => u.token?.category === chain.deployment.paryonTokenId && u.token.nft?.commitment.startsWith('00'))
    .map((u) => parsePriceState(u.token!.nft!.commitment))
    .sort((a, b) => (a.sequence < b.sequence ? 1 : -1));
  if (!threads[0]) {
    throw new Error(chain.server
      ? `The demo price feed was not found on ${chain.server}. That server may not have the demo deployment: `
        + 'use the server "npm run demo:deploy" used (chipnet.bch.ninja unless you passed --server), '
        + 'and check the deployment with "npm run demo:status".'
      : 'The price feed could not be read.');
  }
  return threads[0].priceCents;
}

/** BCH-only coins across all of the wallet's addresses, largest first. */
async function walletCoins(chain: Chain, wallet: WalletSession): Promise<SpendableUtxo[]> {
  const all = await Promise.all(wallet.addresses.map((a) => chain.provider.getUtxosForLockingBytecode(a.lockingBytecode)));
  return all.flat().filter((u) => !u.token).sort((a, b) => (a.satoshis < b.satoshis ? 1 : -1));
}

export async function readPosition(chain: Chain, wallet: WalletSession): Promise<Position> {
  const { provider, paryon, deployment } = chain;
  const priceCents = await currentPriceCents(chain);
  const walletBchSats = (await walletCoins(chain, wallet)).reduce((sum, u) => sum + u.satoshis, 0n);

  const loans: LoanView[] = [];
  const vaultsBySetup = new Map<string, Vault>();
  for (const address of wallet.addresses) {
    for (const source of await findWalletLoans(provider, paryon, deployment, address.lockingBytecode)) {
      const { debtCents } = parseLoanState(source.loan.token!.nft!.commitment);
      const collateralSats = source.loan.satoshis;
      loans.push({
        loanKeyCategory: source.loanKeyCategory, collateralSats, debtCents, source,
        ratioBps: collateralRatioBps(collateralSats, debtCents, priceCents),
        liquidationPriceCents: liquidationPriceCents(collateralSats, debtCents),
      });
    }
    for (const vault of await findOwnedVaults(provider, address.pkh, address.lockingBytecode)) vaultsBySetup.set(vault.setupTxid, vault);
  }

  const vaults: VaultView[] = [];
  for (const vault of vaultsBySetup.values()) {
    const events = await vaultHistory(provider, vault);
    const lookup = await findRescueUtxos(provider, paryon, deployment, vault);
    if (!lookup.found) {
      vaults.push({ vault, events, reserveSats: 0n, active: false });
      continue;
    }
    const { loan, reserve } = lookup.utxos;
    const collateralSats = loan.satoshis;
    const { debtCents } = parseLoanState(loan.token!.nft!.commitment);
    vaults.push({
      vault, events, active: true, reserveSats: reserve.satoshis,
      loan: {
        collateralSats, debtCents,
        ratioBps: collateralRatioBps(collateralSats, debtCents, priceCents),
        liquidationPriceCents: liquidationPriceCents(collateralSats, debtCents),
        triggerPriceCents: priceAtRatio(collateralSats, debtCents, vault.params.triggerRatioBps),
      },
    });
  }
  return { priceCents, walletBchSats, loans, vaults };
}

export interface ProtectionChoices {
  reserveSats: bigint;
  triggerRatioBps: bigint;
  targetRatioBps: bigint;
  maxTopUpSats: bigint;
  maxOverheadSats: bigint;
  cooldownBlocks: bigint;
}

/** The vault belongs to the address that holds the loan key; that key alone can withdraw. */
function ownerAddressOf(wallet: WalletSession, loan: LoanView) {
  const owner = addressForLockingBytecode(wallet, loan.source.loanKey.lockingBytecode);
  if (!owner) throw new Error('The loan key is not at one of this wallet\'s addresses.');
  return owner;
}

export function vaultParams(chain: Chain, wallet: WalletSession, loan: LoanView, choices: ProtectionChoices): BackstopParams {
  return {
    ownerPkh: ownerAddressOf(wallet, loan).pkh,
    loanKeyCategory: loan.loanKeyCategory,
    paryonTokenId: chain.deployment.paryonTokenId,
    manageLockingBytecode: chain.paryon.manage.lockingBytecode,
    triggerRatioBps: choices.triggerRatioBps,
    targetRatioBps: choices.targetRatioBps,
    maxTopUpSats: choices.maxTopUpSats,
    maxOverheadSats: choices.maxOverheadSats,
    cooldownBlocks: choices.cooldownBlocks,
  };
}

const SETUP_FEE_SATS = 2_000n;
const WITHDRAW_FEE_SATS = 2_500n;

/** Which wallet key signs each P2PKH input of a transaction. */
function signersFor(wallet: WalletSession, inputs: SpendableUtxo[]): InputSigners {
  return inputs.flatMap((utxo, inputIndex) => {
    const address = addressForLockingBytecode(wallet, utxo.lockingBytecode);
    return address ? [{ inputIndex, pkh: address.pkh }] : [];
  });
}

/** Signs (in the wallet, or locally in preview) and broadcasts. Returns the transaction id. */
async function signAndSend(chain: Chain, wallet: WalletSession, builder: TransactionBuilder, signers: InputSigners, userPrompt: string): Promise<string> {
  if (wallet.localSigner) return (await builder.send()).txid;
  if (!wallet.signTransaction) throw new Error('This wallet cannot sign transactions.');
  const request = builder.generateWcTransactionObject({ broadcast: false, userPrompt });
  const { signedTransaction } = await wallet.signTransaction(request, signers);
  return chain.provider.sendRawTransaction(signedTransaction);
}

/** The unlocker for a wallet coin: the local key in preview, otherwise a placeholder the wallet fills in. */
function walletUnlocker(wallet: WalletSession, utxo: SpendableUtxo) {
  if (wallet.localSigner) return wallet.localSigner.unlockP2PKH();
  const address = addressForLockingBytecode(wallet, utxo.lockingBytecode);
  if (!address) throw new Error('This coin is not at one of the wallet\'s addresses.');
  return placeholderP2PKHUnlocker(address.address);
}

/** One signature: the loan key and the reserve move into the vault. */
export async function protectLoan(chain: Chain, wallet: WalletSession, loan: LoanView, choices: ProtectionChoices): Promise<string> {
  const params = vaultParams(chain, wallet, loan, choices);
  const vault = vaultContract(params, chain.provider);
  const needed = choices.reserveSats + SETUP_FEE_SATS;
  const funding: SpendableUtxo[] = [];
  let total = 0n;
  for (const coin of await walletCoins(chain, wallet)) {
    if (total >= needed) break;
    funding.push(coin);
    total += coin.satoshis;
  }
  if (total < needed) throw new Error('Your wallet does not have enough BCH for this reserve plus the network fee.');
  const owner = ownerAddressOf(wallet, loan);
  const parts = setupParts({
    vault, params, keyUtxo: loan.source.loanKey, fundingUtxos: funding,
    ownerSigner: (utxo) => walletUnlocker(wallet, utxo),
    // Change goes back to the owner address, so it has a coin for a later one-signature withdraw.
    reserveSats: choices.reserveSats, minerFeeSats: SETUP_FEE_SATS, changeLockingBytecode: owner.lockingBytecode,
  });
  const signers = signersFor(wallet, parts.inputs.map((i) => i.utxo));
  return signAndSend(chain, wallet, buildSetup(chain.provider, parts), signers, 'Protect your ParyonUSD loan with Backstop');
}

/**
 * One signature: the loan key and everything left in the reserve come back to the owner's address.
 * Uses ownerWithdraw: the wallet signs only one of its own coins at the owner address, which works
 * with every wallet (WizardConnect wallets cannot sign inside a contract).
 */
export async function withdrawEverything(chain: Chain, wallet: WalletSession, view: VaultView): Promise<string> {
  const { params } = view.vault;
  const owner = wallet.addresses.find((a) => a.pkh === params.ownerPkh);
  if (!owner) throw new Error('This vault belongs to an address that is not in the connected wallet.');
  const utxos = await chain.provider.getUtxosForLockingBytecode(view.vault.contract.lockingBytecode);
  const key = utxos.find((u) => u.token?.category === params.loanKeyCategory);
  const reserve = utxos.filter((u) => !u.token).sort((a, b) => (a.satoshis < b.satoshis ? 1 : -1))[0];
  if (!key || !reserve) throw new Error('There is nothing left to withdraw.');
  const walletCoin = (await chain.provider.getUtxosForLockingBytecode(owner.lockingBytecode))
    .filter((u) => !u.token && u.satoshis >= WITHDRAW_FEE_SATS)
    .sort((a, b) => (a.satoshis < b.satoshis ? -1 : 1))[0];
  if (!walletCoin) {
    throw new Error(`To withdraw, your wallet needs a little BCH (at least ${WITHDRAW_FEE_SATS} sats) at the address that owns this vault: ${owner.address}`);
  }
  const parts = withdrawWithWalletCoinParts({
    vault: view.vault.contract, params, key, reserve, walletCoin,
    walletSigner: walletUnlocker(wallet, walletCoin), minerFeeSats: WITHDRAW_FEE_SATS,
  });
  return signAndSend(chain, wallet, assemble(chain.provider, parts), [{ inputIndex: 2, pkh: owner.pkh }], 'Withdraw your loan key and reserve from Backstop');
}
