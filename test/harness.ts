// Test world: a mock network holding a Paryon loan, the price contract it reads from,
// and a Backstop vault protecting it.
import { Contract, MockNetworkProvider, SignatureTemplate, type SpendableUtxo, type TransactionBuilder } from 'cashscript';
import { compileFile } from 'cashc';
import { binToHex, hash160, secp256k1, sha256, utf8ToBin } from '@bitauth/libauth';
import { expect } from 'vitest';
import {
  assemble,
  DEFAULT_RULES,
  encodeLoanState,
  encodePriceState,
  LOAN_SIDECAR_COMMITMENT,
  MANAGE_FUNCTION_COMMITMENT,
  PARYON_DUST,
  paryonContracts,
  paryonUnlockers,
  planRescue,
  readRescueState,
  rescueParts,
  vaultContract,
  type BackstopParams,
  type ParyonUnlockers,
  type RescueUtxos,
  type TransactionParts,
} from '@backstop/contracts';

export const BCH = 100_000_000n;
export const dollars = (usd: number) => BigInt(Math.round(usd * 100)); // to cents

/** 'paryon': Paryon's real compiled contracts. 'standIn': Paryon's checks removed. */
export type Mode = 'paryon' | 'standIn';

/** A deterministic test key. */
export function testKey(label: string) {
  const privateKey = sha256.hash(utf8ToBin(`backstop test key: ${label}`));
  const publicKey = secp256k1.derivePublicKeyCompressed(privateKey) as Uint8Array;
  const pkh = hash160(publicKey);
  return {
    privateKey,
    publicKey,
    pkh: binToHex(pkh),
    lockingBytecode: `76a914${binToHex(pkh)}88ac`,
    signer: new SignatureTemplate(privateKey),
  };
}

export const owner = testKey('owner');
export const stranger = testKey('stranger');
export const keeper = testKey('keeper');
export const demoOracle = testKey('demo oracle');

const category = (label: string) => binToHex(sha256.hash(utf8ToBin(`backstop test category: ${label}`)));
export const PARYON_TOKEN_ID = category('paryon');
export const LOAN_KEY_CATEGORY = category('loan key');
export const MIGRATION_KEY_CATEGORY = category('migration key');

const standInArtifact = compileFile(new URL('./fixtures/PermissiveStandIn.cash', import.meta.url));

export interface WorldOptions {
  mode?: Mode;
  priceCents?: bigint;
  priceSequence?: bigint;
  collateralSats?: bigint;
  debtCents?: bigint;
  reserveSats?: bigint;
  rules?: Partial<Omit<BackstopParams, 'ownerPkh' | 'loanKeyCategory' | 'paryonTokenId' | 'manageLockingBytecode'>>;
}

// Default loan: 1 BCH collateral, $230 debt. At $300/BCH that is 130% (safe, trigger is 125%).
// At $270/BCH it is 117%: below the trigger but not yet liquidatable (110%).
export const DEFAULTS = {
  collateralSats: 1n * BCH,
  debtCents: dollars(230),
  safePriceCents: dollars(300),
  crashPriceCents: dollars(270),
  reserveSats: 1n * BCH,
  maxTopUpSats: BCH / 2n,
  minerFeeSats: 3_000n,
  keeperRewardSats: 2_000n,
};

let txCounter = 0;
const freshTxid = () => binToHex(sha256.hash(utf8ToBin(`backstop test tx ${++txCounter}`)));

export function createWorld(options: WorldOptions = {}) {
  const mode = options.mode ?? 'paryon';
  const provider = new MockNetworkProvider();

  const paryon = paryonContracts(provider, { oraclePublicKey: binToHex(demoOracle.publicKey), migrationKeyCategory: MIGRATION_KEY_CATEGORY });
  const standIn = (role: string) => new Contract(standInArtifact, [binToHex(utf8ToBin(role))], { provider, contractType: 'p2sh32' });
  const contracts = mode === 'paryon'
    ? paryon
    : { price: standIn('price'), loan: standIn('loan'), sidecar: standIn('sidecar'), manage: standIn('manage') };

  const params: BackstopParams = {
    ownerPkh: owner.pkh,
    loanKeyCategory: LOAN_KEY_CATEGORY,
    paryonTokenId: PARYON_TOKEN_ID,
    manageLockingBytecode: contracts.manage.lockingBytecode,
    triggerRatioBps: DEFAULT_RULES.triggerRatioBps,
    targetRatioBps: DEFAULT_RULES.targetRatioBps,
    maxTopUpSats: DEFAULTS.maxTopUpSats,
    maxOverheadSats: DEFAULT_RULES.maxOverheadSats,
    cooldownBlocks: DEFAULT_RULES.cooldownBlocks,
    ...options.rules,
  };
  const vault = vaultContract(params, provider);

  const add = (lockingBytecode: string, utxo: Omit<SpendableUtxo, 'lockingBytecode'>) => provider.addUtxo(lockingBytecode, utxo);

  const loanTxid = freshTxid();
  const loanState = encodeLoanState({
    debtCents: options.debtCents ?? DEFAULTS.debtCents,
    amountBeingRedeemed: 0n,
    status: 2,
    lastPeriodInterestPaid: 5n,
    currentInterestRate: 100n,
    nextInterestRate: 100n,
    interestManagerConfiguration: '0000000000',
  });

  const utxos: RescueUtxos = {
    price: add(contracts.price.lockingBytecode, {
      txid: freshTxid(), vout: 0, satoshis: PARYON_DUST,
      token: { category: PARYON_TOKEN_ID, amount: 0n, nft: { capability: 'mutable', commitment: encodePriceState({ sequence: options.priceSequence ?? 1000n, priceCents: options.priceCents ?? DEFAULTS.crashPriceCents }) } },
    }),
    // Paryon creates a loan and its sidecar as adjacent outputs of one transaction.
    loan: add(contracts.loan.lockingBytecode, {
      txid: loanTxid, vout: 2, satoshis: options.collateralSats ?? DEFAULTS.collateralSats,
      token: { category: PARYON_TOKEN_ID, amount: 0n, nft: { capability: 'mutable', commitment: loanState } },
    }),
    sidecar: add(contracts.sidecar.lockingBytecode, {
      txid: loanTxid, vout: 3, satoshis: PARYON_DUST,
      token: { category: LOAN_KEY_CATEGORY, amount: 0n, nft: { capability: 'none', commitment: LOAN_SIDECAR_COMMITMENT } },
    }),
    manage: add(contracts.manage.lockingBytecode, {
      txid: freshTxid(), vout: 0, satoshis: PARYON_DUST,
      token: { category: PARYON_TOKEN_ID, amount: 0n, nft: { capability: 'none', commitment: MANAGE_FUNCTION_COMMITMENT } },
    }),
    key: add(vault.lockingBytecode, {
      txid: freshTxid(), vout: 0, satoshis: PARYON_DUST,
      token: { category: LOAN_KEY_CATEGORY, amount: 0n, nft: { capability: 'minting', commitment: '' } },
    }),
    reserve: add(vault.lockingBytecode, { txid: freshTxid(), vout: 1, satoshis: options.reserveSats ?? DEFAULTS.reserveSats }),
  };

  const unlockers = (): ParyonUnlockers => mode === 'paryon'
    ? paryonUnlockers(paryon, utxos.loan)
    : { price: contracts.price.unlock.spend(), loan: contracts.loan.unlock.spend(), sidecar: contracts.sidecar.unlock.spend(), manage: contracts.manage.unlock.spend() };

  /** The top-up a well-behaved keeper would choose right now. */
  function plannedTopUp(overheadSats = DEFAULTS.minerFeeSats + DEFAULTS.keeperRewardSats): bigint {
    const plan = planRescue({ params, ...readRescueState(utxos), overheadSats });
    if (!plan.ok) throw new Error(`no rescue possible: ${plan.reason}`);
    return plan.topUpSats;
  }

  /** The parts of a correct rescue. Attack tests start here and change one thing. */
  function rescue(overrides: { topUpSats?: bigint; minerFeeSats?: bigint; keeperRewardSats?: bigint } = {}): TransactionParts {
    return rescueParts({
      vault,
      params,
      utxos,
      unlockers: unlockers(),
      topUpSats: overrides.topUpSats ?? plannedTopUp(),
      minerFeeSats: overrides.minerFeeSats ?? DEFAULTS.minerFeeSats,
      keeperRewardSats: overrides.keeperRewardSats ?? DEFAULTS.keeperRewardSats,
      keeperLockingBytecode: keeper.lockingBytecode,
    });
  }

  const build = (parts: TransactionParts): TransactionBuilder => assemble(provider, parts);

  /** Adds an extra UTXO to the mock chain (for attacks that bring their own inputs). */
  const addUtxo = (lockingBytecode: string, utxo: Omit<SpendableUtxo, 'lockingBytecode' | 'txid'> & { txid?: string }) =>
    add(lockingBytecode, { txid: freshTxid(), ...utxo });

  return { mode, provider, paryon, contracts, params, vault, utxos, unlockers, plannedTopUp, rescue, build, addUtxo };
}

export type World = ReturnType<typeof createWorld>;

/**
 * Asserts that a transaction is rejected, and by which rule.
 * - With Paryon's checks removed, it must fail on Backstop's own require (`backstop`).
 * - Against Paryon's real contracts it must fail too: on Backstop's require, or on the Paryon
 *   require named in `paryonFirst` where Paryon happens to reject the same thing earlier.
 */
export function expectRejected(world: World, parts: TransactionParts, backstop: RegExp, paryonFirst?: RegExp) {
  const builder = world.build(parts);
  const expected = world.mode === 'paryon' && paryonFirst ? paryonFirst : backstop;
  expect(builder).toFailRequireWith(expected);
}

/** Sends a transaction on the mock network (full VM validation) and returns it. */
export async function expectAccepted(world: World, parts: TransactionParts) {
  return world.build(parts).send();
}
