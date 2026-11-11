// What the app reads and does. Every number comes from the chain; nothing is stored anywhere else.
import { placeholderP2PKHUnlocker, placeholderPublicKey, placeholderSignature, type TransactionBuilder } from 'cashscript';
import {
  assemble, buildSetup, collateralRatioBps, findOwnedVaults, findRescueUtxos, findWalletLoans, liquidationPriceCents, parseLoanState,
  parsePriceState, priceAtRatio, setupParts, vaultContract, vaultHistory, withdrawParts,
  type BackstopParams, type Vault, type VaultEvent, type WalletLoan,
} from '@backstop/contracts';
import type { Chain } from './chain';
import type { WalletSession } from './wallet';

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
  if (!threads[0]) throw new Error('The price feed could not be read.');
  return threads[0].priceCents;
}

export async function readPosition(chain: Chain, wallet: WalletSession): Promise<Position> {
  const { provider, paryon, deployment } = chain;
  const priceCents = await currentPriceCents(chain);
  const walletUtxos = await provider.getUtxosForLockingBytecode(wallet.lockingBytecode);
  const walletBchSats = walletUtxos.filter((u) => !u.token).reduce((sum, u) => sum + u.satoshis, 0n);

  const loans = (await findWalletLoans(provider, paryon, deployment, wallet.lockingBytecode)).map((source): LoanView => {
    const { debtCents } = parseLoanState(source.loan.token!.nft!.commitment);
    const collateralSats = source.loan.satoshis;
    return {
      loanKeyCategory: source.loanKeyCategory, collateralSats, debtCents, source,
      ratioBps: collateralRatioBps(collateralSats, debtCents, priceCents),
      liquidationPriceCents: liquidationPriceCents(collateralSats, debtCents),
    };
  });

  const vaults: VaultView[] = [];
  for (const vault of await findOwnedVaults(provider, wallet.pkh, wallet.lockingBytecode)) {
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

export function vaultParams(chain: Chain, wallet: WalletSession, loan: LoanView, choices: ProtectionChoices): BackstopParams {
  return {
    ownerPkh: wallet.pkh,
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

/** Signs (in the wallet, or locally in preview) and broadcasts. Returns the transaction id. */
async function signAndSend(chain: Chain, wallet: WalletSession, builder: TransactionBuilder, userPrompt: string): Promise<string> {
  if (wallet.localSigner) return (await builder.send()).txid;
  if (!wallet.signTransaction) throw new Error('This wallet cannot sign transactions.');
  const request = builder.generateWcTransactionObject({ broadcast: false, userPrompt });
  const { signedTransaction } = await wallet.signTransaction(request);
  return chain.provider.sendRawTransaction(signedTransaction);
}

/** One signature: the loan key and the reserve move into the vault. */
export async function protectLoan(chain: Chain, wallet: WalletSession, loan: LoanView, choices: ProtectionChoices): Promise<string> {
  const params = vaultParams(chain, wallet, loan, choices);
  const vault = vaultContract(params, chain.provider);
  const coins = (await chain.provider.getUtxosForLockingBytecode(wallet.lockingBytecode))
    .filter((u) => !u.token)
    .sort((a, b) => (a.satoshis < b.satoshis ? 1 : -1));
  const needed = choices.reserveSats + SETUP_FEE_SATS;
  const funding = [];
  let total = 0n;
  for (const coin of coins) {
    if (total >= needed) break;
    funding.push(coin);
    total += coin.satoshis;
  }
  if (total < needed) throw new Error('Your wallet does not have enough BCH for this reserve plus the network fee.');
  const parts = setupParts({
    vault, params, keyUtxo: loan.source.loanKey, fundingUtxos: funding,
    ownerSigner: wallet.localSigner ?? placeholderP2PKHUnlocker(wallet.address),
    reserveSats: choices.reserveSats, minerFeeSats: SETUP_FEE_SATS, changeLockingBytecode: wallet.lockingBytecode,
  });
  return signAndSend(chain, wallet, buildSetup(chain.provider, parts), 'Protect your ParyonUSD loan with Backstop');
}

/** One signature: the loan key and everything left in the reserve come back to the wallet. */
export async function withdrawEverything(chain: Chain, wallet: WalletSession, view: VaultView): Promise<string> {
  const utxos = await chain.provider.getUtxosForLockingBytecode(view.vault.contract.lockingBytecode);
  const key = utxos.find((u) => u.token?.category === view.vault.params.loanKeyCategory);
  const reserve = utxos.filter((u) => !u.token).sort((a, b) => (a.satoshis < b.satoshis ? 1 : -1))[0];
  if (!key || !reserve) throw new Error('There is nothing left to withdraw.');
  const parts = withdrawParts({
    vault: view.vault.contract, key, reserve,
    ownerSigner: wallet.localSigner ?? { publicKey: placeholderPublicKey(), signature: placeholderSignature() },
    minerFeeSats: WITHDRAW_FEE_SATS, toLockingBytecode: wallet.lockingBytecode,
  });
  return signAndSend(chain, wallet, assemble(chain.provider, parts), 'Withdraw your loan key and reserve from Backstop');
}
