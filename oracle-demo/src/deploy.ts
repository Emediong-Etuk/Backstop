// DEMO DEPLOYMENT of Paryon's add-collateral contracts to chipnet (Plan B in docs/PHASE0.md).
//
// Paryon has no public chipnet deployment, so this creates one from Paryon's own published,
// unmodified bytecode (@paryonusd/contracts): PriceContractGuarded, Loan, LoanSidecar and the
// manage function. It uses our own token categories and the DEMO oracle key.
//
// What it does not deploy: Borrowing, the loan-key factory, the stability pool and liquidation.
// Demo loans are created directly in the genesis transaction with a written loan state, not
// through Paryon's `borrow`. The add-collateral transaction a rescue uses is exactly Paryon's.
import { TransactionBuilder, type NetworkProvider, type SpendableUtxo } from 'cashscript';
import { binToHex, decodeTransaction, hexToBin, sha256, utf8ToBin } from '@bitauth/libauth';
import {
  encodeLoanState, encodePriceState, LOAN_SIDECAR_COMMITMENT, MANAGE_FUNCTION_COMMITMENT, PARYON_DUST, paryonContracts,
} from '@backstop/contracts';
import type { Deployment } from '@backstop/contracts';
import { pickCoins, type DemoWallet } from './wallet.js';

/**
 * Migration-key category for the demo price contract: a hash of a sentence, not the id of any
 * transaction, so no migration key can ever exist and the demo price contract cannot be migrated.
 */
export const DEMO_NO_MIGRATION_KEY = binToHex(sha256.hash(utf8ToBin('Backstop demo: this price contract has no migration key')));

export interface DemoLoanSpec {
  collateralSats: bigint;
  debtCents: bigint;
  /** Where the loan key goes: the demo borrower, or a Cashonize wallet for the web demo. Locking bytecode hex. */
  borrowerLockingBytecode: string;
}

export interface DemoLoan extends DemoLoanSpec {
  loanKeyCategory: string;
  genesisTxid: string;
  loanVout: number;
}

export interface DemoDeployment extends Deployment {
  demo: {
    createdAt: string;
    genesisTxid: string;
    startPriceCents: string;
    priceThreads: number;
    manageThreads: number;
    loans: Array<Omit<DemoLoan, 'collateralSats' | 'debtCents'> & { collateralSats: string; debtCents: string }>;
  };
}

/** Starting sequence of the demo price contract; the demo oracle continues from here. */
export const DEMO_START_SEQUENCE = 1_000n;

export async function deployDemo(args: {
  provider: NetworkProvider;
  funder: DemoWallet;
  oracle: DemoWallet;
  startPriceCents: bigint;
  loans: DemoLoanSpec[];
  manageThreads?: number;
  feeRate?: number;
  log?: (line: string) => void;
}): Promise<DemoDeployment> {
  const { provider, funder, oracle, startPriceCents, loans } = args;
  const log = args.log ?? console.log;
  const manageThreads = args.manageThreads ?? 3;
  const feeRate = args.feeRate ?? 1.1;
  if (loans.some((l) => l.debtCents < 100_00n)) throw new Error('Paryon loans need at least 100.00 PUSD of debt (manage.cash:92)');

  // A token category is the id of the transaction whose output 0 its genesis input spends.
  // One category for Paryon, plus one loan-key category per demo loan, so 1 + loans.length
  // preparation transactions, each leaving a fresh output 0 for the genesis transaction.
  const genesisNeeds = loans.reduce((sum, l) => sum + l.collateralSats + 2n * PARYON_DUST, 0n)
    + BigInt(1 + manageThreads) * PARYON_DUST + 20_000n;
  const prepCount = 1 + loans.length;
  let coins = await pickCoins(provider, funder, genesisNeeds + BigInt(prepCount) * 1_000n, 'Funder');
  const genesisInputs: SpendableUtxo[] = [];
  for (let i = 0; i < prepCount; i++) {
    const builder = new TransactionBuilder({ provider });
    for (const coin of coins) builder.addInput(coin, funder.signer.unlockP2PKH());
    const keep = 2_000n; // output 0: the genesis outpoint
    builder.addOutput({ to: funder.address, amount: keep });
    builder.addBchChangeOutputIfNeeded({ to: funder.address, feeRate });
    const hex = builder.build();
    const { txid } = await builder.send();
    log(`prepared genesis outpoint ${i + 1}/${prepCount}: ${txid}`);
    genesisInputs.push({ txid, vout: 0, satoshis: keep, lockingBytecode: funder.lockingBytecode });
    // The change (output 1) funds the next step.
    const decoded = decodeTransaction(hexToBin(hex));
    if (typeof decoded === 'string' || decoded.outputs.length < 2) throw new Error('preparation transaction has no change');
    coins = [{ txid, vout: 1, satoshis: decoded.outputs[1].valueSatoshis, lockingBytecode: funder.lockingBytecode }];
  }

  const paryonTokenId = genesisInputs[0].txid;
  const deployment: Deployment = {
    network: 'chipnet',
    label: "Backstop DEMO deployment of Paryon's unmodified add-collateral contracts, DEMO oracle key",
    paryonTokenId,
    oraclePublicKey: binToHex(oracle.publicKey),
    migrationKeyCategory: DEMO_NO_MIGRATION_KEY,
  };
  const paryon = paryonContracts(provider, { oraclePublicKey: deployment.oraclePublicKey, migrationKeyCategory: deployment.migrationKeyCategory });

  // Genesis transaction. Each loan is immediately followed by its sidecar: Paryon's Loan contract
  // requires the sidecar to be the next output of the same transaction (Loan.cash:29-31).
  const genesis = new TransactionBuilder({ provider });
  for (const input of [...genesisInputs, ...coins]) genesis.addInput(input, funder.signer.unlockP2PKH());
  genesis.addOutput({
    to: hexToBin(paryon.price.lockingBytecode), amount: PARYON_DUST,
    token: { category: paryonTokenId, amount: 0n, nft: { capability: 'mutable', commitment: encodePriceState({ sequence: DEMO_START_SEQUENCE, priceCents: startPriceCents }) } },
  });
  for (let i = 0; i < manageThreads; i++) {
    genesis.addOutput({
      to: hexToBin(paryon.manage.lockingBytecode), amount: PARYON_DUST,
      token: { category: paryonTokenId, amount: 0n, nft: { capability: 'none', commitment: MANAGE_FUNCTION_COMMITMENT } },
    });
  }
  const created: DemoLoan[] = [];
  loans.forEach((loan, i) => {
    const loanKeyCategory = genesisInputs[1 + i].txid;
    const loanVout = 1 + manageThreads + 3 * i;
    const state = encodeLoanState({
      debtCents: loan.debtCents, amountBeingRedeemed: 0n, status: 2, lastPeriodInterestPaid: 0n,
      currentInterestRate: 100n, nextInterestRate: 100n, interestManagerConfiguration: '0000000000',
    });
    genesis.addOutput({ to: hexToBin(paryon.loan.lockingBytecode), amount: loan.collateralSats, token: { category: paryonTokenId, amount: 0n, nft: { capability: 'mutable', commitment: state } } });
    genesis.addOutput({ to: hexToBin(paryon.sidecar.lockingBytecode), amount: PARYON_DUST, token: { category: loanKeyCategory, amount: 0n, nft: { capability: 'none', commitment: LOAN_SIDECAR_COMMITMENT } } });
    genesis.addOutput({ to: hexToBin(loan.borrowerLockingBytecode), amount: PARYON_DUST, token: { category: loanKeyCategory, amount: 0n, nft: { capability: 'minting', commitment: '' } } });
    created.push({ ...loan, loanKeyCategory, genesisTxid: '', loanVout });
  });
  genesis.addBchChangeOutputIfNeeded({ to: funder.address, feeRate });
  const { txid: genesisTxid } = await genesis.send();
  log(`genesis: ${genesisTxid}`);
  created.forEach((l) => { l.genesisTxid = genesisTxid; });

  return {
    ...deployment,
    demo: {
      createdAt: new Date().toISOString(),
      genesisTxid,
      startPriceCents: startPriceCents.toString(),
      priceThreads: 1,
      manageThreads,
      loans: created.map((l) => ({ ...l, collateralSats: l.collateralSats.toString(), debtCents: l.debtCents.toString() })),
    },
  };
}
