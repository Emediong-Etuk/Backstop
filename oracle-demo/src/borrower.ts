// Scripted borrower actions for the demo, using the demo borrower's key from .env.
// The web app (Phase 4) does the same through the borrower's own wallet with one signature.
import type { NetworkProvider } from 'cashscript';
import {
  assemble, buildSetup, collateralRatioBps, DEFAULT_RULES, liquidationPriceCents, priceAtRatio, readRescueState, setupParts,
  vaultContract, withdrawParts, type BackstopParams,
} from '@backstop/contracts';
import { deploymentContracts, findRescueUtxos, loadVault, type Deployment } from '@backstop/contracts';
import { pickCoins, type DemoWallet } from './wallet.js';

export interface SetupOptions {
  provider: NetworkProvider;
  deployment: Deployment;
  borrower: DemoWallet;
  loanKeyCategory: string;
  reserveSats: bigint;
  maxTopUpSats?: bigint;
  triggerRatioBps?: bigint;
  targetRatioBps?: bigint;
  maxOverheadSats?: bigint;
  cooldownBlocks?: bigint;
}

export async function setUpDemoVault(options: SetupOptions): Promise<{ setupTxid: string; params: BackstopParams; address: string }> {
  const { provider, deployment, borrower, loanKeyCategory, reserveSats } = options;
  const paryon = deploymentContracts(provider, deployment);
  const params: BackstopParams = {
    ownerPkh: borrower.pkh,
    loanKeyCategory,
    paryonTokenId: deployment.paryonTokenId,
    manageLockingBytecode: paryon.manage.lockingBytecode,
    triggerRatioBps: options.triggerRatioBps ?? DEFAULT_RULES.triggerRatioBps,
    targetRatioBps: options.targetRatioBps ?? DEFAULT_RULES.targetRatioBps,
    maxTopUpSats: options.maxTopUpSats ?? reserveSats / 2n,
    maxOverheadSats: options.maxOverheadSats ?? DEFAULT_RULES.maxOverheadSats,
    cooldownBlocks: options.cooldownBlocks ?? DEFAULT_RULES.cooldownBlocks,
  };
  const vault = vaultContract(params, provider);
  const key = (await provider.getUtxosForLockingBytecode(borrower.lockingBytecode))
    .find((u) => u.token?.category === loanKeyCategory && u.token.nft?.capability === 'minting');
  if (!key) throw new Error(`the borrower wallet ${borrower.tokenAddress} does not hold the loan key ${loanKeyCategory}`);
  const minerFeeSats = 2_000n;
  const funding = await pickCoins(provider, borrower, reserveSats + minerFeeSats, 'Borrower');
  const parts = setupParts({
    vault, params, keyUtxo: key, fundingUtxos: funding, ownerSigner: borrower.signer,
    reserveSats, minerFeeSats, changeLockingBytecode: borrower.lockingBytecode,
  });
  const { txid } = await buildSetup(provider, parts).send();
  return { setupTxid: txid, params, address: vault.address };
}

export async function withdrawDemoVault(args: { provider: NetworkProvider; borrower: DemoWallet; setupTxid: string }): Promise<string> {
  const { provider, borrower, setupTxid } = args;
  const vault = await loadVault(provider, setupTxid);
  const utxos = await provider.getUtxosForLockingBytecode(vault.contract.lockingBytecode);
  const key = utxos.find((u) => u.token?.category === vault.params.loanKeyCategory);
  const reserve = utxos.filter((u) => !u.token).sort((a, b) => (a.satoshis < b.satoshis ? 1 : -1))[0];
  if (!key || !reserve) throw new Error('vault is already empty');
  const parts = withdrawParts({
    vault: vault.contract, key, reserve, ownerSigner: borrower.signer, minerFeeSats: 2_000n, toLockingBytecode: borrower.lockingBytecode,
  });
  return (await assemble(provider, parts).send()).txid;
}

export interface VaultStatus {
  address: string;
  priceCents: bigint;
  debtCents: bigint;
  collateralSats: bigint;
  reserveSats: bigint;
  ratioBps: bigint;
  triggerPriceCents: bigint;
  liquidationPriceCents: bigint;
}

export async function vaultStatus(args: { provider: NetworkProvider; deployment: Deployment; setupTxid: string }): Promise<VaultStatus | { address: string; empty: string }> {
  const vault = await loadVault(args.provider, args.setupTxid);
  const lookup = await findRescueUtxos(args.provider, deploymentContracts(args.provider, args.deployment), args.deployment, vault);
  if (!lookup.found) return { address: vault.contract.address, empty: lookup.reason };
  const s = readRescueState(lookup.utxos);
  return {
    address: vault.contract.address,
    ...s,
    ratioBps: collateralRatioBps(s.collateralSats, s.debtCents, s.priceCents),
    triggerPriceCents: priceAtRatio(s.collateralSats, s.debtCents, vault.params.triggerRatioBps),
    liquidationPriceCents: liquidationPriceCents(s.collateralSats, s.debtCents),
  };
}
