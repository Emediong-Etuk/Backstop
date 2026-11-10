// Helpers for Paryon's on-chain state and contracts.
// Contract code comes unmodified from @paryonusd/contracts (the audited, published artifacts).
import { Contract, type NetworkProvider } from 'cashscript';
import { paryonArtifacts } from '@paryonusd/contracts';
import { assertHex, readUintLE, reverseHex, uintLE } from './bytes.js';

export { paryonArtifacts };

/** Commitment of the manage function NFT (LoanFunction.MANAGE_LOAN, contract_overview.md:165). */
export const MANAGE_FUNCTION_COMMITMENT = '02';
/** Commitment of the loan sidecar NFT (Borrowing.cash:92). */
export const LOAN_SIDECAR_COMMITMENT = '01';
/** Every Paryon helper UTXO (price contract, sidecar, function, loan key) holds 1000 sats. */
export const PARYON_DUST = 1000n;

/** The 27-byte loan state (Loan.cash:9-20). */
export interface LoanState {
  /** Debt in PUSD cents. */
  debtCents: bigint;
  amountBeingRedeemed: bigint;
  status: number;
  lastPeriodInterestPaid: bigint;
  currentInterestRate: bigint;
  nextInterestRate: bigint;
  /** interestManager (1) + minRateManager (2) + maxRateManager (2), hex. */
  interestManagerConfiguration: string;
}

export function parseLoanState(commitmentHex: string): LoanState {
  assertHex(commitmentHex, 27, 'loan state');
  if (commitmentHex.slice(0, 2) !== '01') throw new Error('loan state: identifier must be 0x01');
  const at = (start: number, length: number) => commitmentHex.slice(start * 2, (start + length) * 2);
  return {
    debtCents: readUintLE(at(1, 6)),
    amountBeingRedeemed: readUintLE(at(7, 6)),
    status: Number(readUintLE(at(13, 1))),
    lastPeriodInterestPaid: readUintLE(at(14, 4)),
    currentInterestRate: readUintLE(at(18, 2)),
    nextInterestRate: readUintLE(at(20, 2)),
    interestManagerConfiguration: at(22, 5),
  };
}

export function encodeLoanState(state: LoanState): string {
  assertHex(state.interestManagerConfiguration, 5, 'interestManagerConfiguration');
  return '01'
    + uintLE(state.debtCents, 6)
    + uintLE(state.amountBeingRedeemed, 6)
    + uintLE(state.status, 1)
    + uintLE(state.lastPeriodInterestPaid, 4)
    + uintLE(state.currentInterestRate, 2)
    + uintLE(state.nextInterestRate, 2)
    + state.interestManagerConfiguration;
}

/** Price contract state (PriceContract.cash:8-13): 0x00 + sequence (4) + price in cents per BCH (4). */
export interface PriceState {
  sequence: bigint;
  priceCents: bigint;
}

export function parsePriceState(commitmentHex: string): PriceState {
  if (commitmentHex.slice(0, 2) !== '00' || commitmentHex.length < 18) throw new Error('price state: not a price contract');
  return { sequence: readUintLE(commitmentHex.slice(2, 10)), priceCents: readUintLE(commitmentHex.slice(10, 18)) };
}

export function encodePriceState(state: PriceState): string {
  return '00' + uintLE(state.sequence, 4) + uintLE(state.priceCents, 4);
}

export interface ParyonContractOptions {
  /** Oracle public key the price contract accepts (the demo oracle on chipnet). */
  oraclePublicKey: string;
  /** Category of the migration key, display order. Unused by Backstop, but part of the price contract's address. */
  migrationKeyCategory: string;
}

/**
 * The four Paryon contracts on the add-collateral path. Loan, LoanSidecar and manage take no
 * constructor arguments, so their addresses are the same in every deployment that uses this code.
 */
export function paryonContracts(provider: NetworkProvider, options: ParyonContractOptions) {
  const opts = { provider, contractType: 'p2sh32' as const };
  return {
    price: new Contract(paryonArtifacts.artifactPriceContractGuarded, [options.oraclePublicKey, reverseHex(options.migrationKeyCategory)], opts),
    loan: new Contract(paryonArtifacts.artifactLoan, [], opts),
    sidecar: new Contract(paryonArtifacts.artifactLoanSidecar, [], opts),
    manage: new Contract(paryonArtifacts.loanContractFunctions.artifactFunctionManage, [], opts),
  };
}

export type ParyonContracts = ReturnType<typeof paryonContracts>;
