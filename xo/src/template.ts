// Backstop as an XO template.
//
// Three actions:
//   protectLoan (owner)  move the loan key and a BCH reserve into the vault, publish the vault's rules
//   rescue      (keeper) Paryon's add-collateral transaction, topping up the loan from the reserve
//   withdraw    (owner)  take the loan key and the whole reserve back
//
// The contract bytecode is read from the compiled artifacts (contracts/artifacts/Backstop.artifact.ts
// and @paryonusd/contracts), so the template always locks to exactly the contract the tests cover.
// test/xo.test.ts checks that every script here compiles to the same bytes CashScript produces.
//
// Conventions, matching how the XO engine passes variables to the compiler
// (convertInvitationVariableValueForCompiler in @xo-cash/engine):
//   - integers and satoshi amounts become minimal VM numbers;
//   - hex strings become their bytes as written. Token categories are given in display order (as
//     wallets and explorers show them) and reversed with OP_REVERSEBYTES where the contract needs
//     the order the VM sees.
import type { XOTemplate } from '@xo-cash/types';
import { BackstopArtifact } from '@backstop/contracts';
import { paryonArtifacts } from '@paryonusd/contracts';

const hex = (artifact: { debug?: { bytecode: string } }, name: string) => {
  if (!artifact.debug?.bytecode) throw new Error(`${name} artifact has no compiled bytecode`);
  return `0x${artifact.debug.bytecode}`;
};

export const BACKSTOP_BYTECODE = hex(BackstopArtifact, 'Backstop');
export const PARYON_BYTECODE = {
  price: hex(paryonArtifacts.artifactPriceContractGuarded, 'PriceContractGuarded'),
  loan: hex(paryonArtifacts.artifactLoan, 'Loan'),
  sidecar: hex(paryonArtifacts.artifactLoanSidecar, 'LoanSidecar'),
  manage: hex(paryonArtifacts.loanContractFunctions.artifactFunctionManage, 'manage'),
};

/** Variables describing one vault: its owner, its loan, and its rules. */
const VAULT_VARIABLES = [
  'ownerPkh', 'loanKeyCategory', 'paryonTokenId',
  'triggerRatioBps', 'targetRatioBps', 'maxTopUpSatoshis', 'maxOverheadSatoshis', 'cooldownBlocks',
];

/** Variables describing where Paryon's contracts live (the deployment). */
const DEPLOYMENT_VARIABLES = ['paryonTokenId', 'oraclePublicKey', 'migrationKeyCategory'];

const scripts: Record<string, string> = {
  // ---- Backstop ----
  // CashScript's redeem script: constructor arguments pushed in reverse order, then the bytecode.
  backstopRedeem: [
    '<cooldownBlocks> <maxOverheadSatoshis> <maxTopUpSatoshis> <targetRatioBps> <triggerRatioBps>',
    '<paryonManageLocking>',
    '<$(<paryonTokenId> OP_REVERSEBYTES)> <$(<loanKeyCategory> OP_REVERSEBYTES)>',
    '<ownerPkh>',
    BACKSTOP_BYTECODE,
  ].join(' '),
  // rescue() is function 0, ownerSpend(pubkey, sig) is function 1. Arguments are pushed in reverse.
  unlockVaultRescue: '<0> <backstopRedeem>',
  unlockVaultWithdraw: '<ownerKey.schnorr_signature.all_outputs> <ownerKey.public_key> <1> <backstopRedeem>',

  // ---- Paryon's contracts, unmodified bytecode from @paryonusd/contracts 1.1.0 ----
  // PriceContractGuarded(oraclePublicKey, tokenIdMigrationKey): sharePrice() is function 1.
  paryonPriceRedeem: `<$(<migrationKeyCategory> OP_REVERSEBYTES)> <oraclePublicKey> ${PARYON_BYTECODE.price}`,
  unlockPriceShare: '<1> <paryonPriceRedeem>',
  // Loan, LoanSidecar and manage take no constructor arguments and have one function each.
  paryonLoanRedeem: PARYON_BYTECODE.loan,
  unlockLoan: '<paryonLoanRedeem>',
  paryonSidecarRedeem: PARYON_BYTECODE.sidecar,
  unlockSidecar: '<paryonSidecarRedeem>',
  paryonManageRedeem: PARYON_BYTECODE.manage,
  // manage(repayAmount = 0, interestManagerConfiguration = the loan's current setting, its last 5 bytes),
  // so the loan state stays byte-for-byte unchanged, which Backstop requires.
  unlockManage: '<$(<loanCommitment> <22> OP_SPLIT OP_NIP)> <0> <paryonManageRedeem>',
  // P2SH32 locking bytecode of the manage function: Backstop pins input 3 to it.
  paryonManageLocking: 'OP_HASH256 <$(<paryonManageRedeem> OP_HASH256)> OP_EQUAL',

  // ---- Setup OP_RETURN: lets anyone rebuild the vault from chain data (contracts/src/vault.ts) ----
  // payload v1: 0x01 | ownerPkh | loanKeyCategory | paryonTokenId | 0x23 | manage locking (35)
  //             | trigger u16 | target u16 | maxTopUp u64 | maxOverhead u32 | cooldown u16
  setupPayload: [
    '<0x01> <ownerPkh> OP_CAT <loanKeyCategory> OP_CAT <paryonTokenId> OP_CAT',
    '<0x23> OP_CAT <paryonManageLocking> OP_CAT',
    '<triggerRatioBps> <2> OP_NUM2BIN OP_CAT <targetRatioBps> <2> OP_NUM2BIN OP_CAT',
    '<maxTopUpSatoshis> <8> OP_NUM2BIN OP_CAT <maxOverheadSatoshis> <4> OP_NUM2BIN OP_CAT',
    '<cooldownBlocks> <2> OP_NUM2BIN OP_CAT',
  ].join(' '),
  setupOpReturn: "OP_RETURN <'BKSP'> <$(setupPayload)>",

  // ---- Destinations chosen by participants ----
  keeperRewardLocking: '$(<keeperLockingScript>)',
  ownerReturnLocking: '$(<returnLockingScript>)',

  // ---- Amounts ----
  rescueLoanSatoshis: '<loanSatoshis> <topUpSatoshis> OP_ADD',
  rescueReserveSatoshis: '<reserveSatoshis> <topUpSatoshis> OP_SUB <minerFeeSatoshis> OP_SUB <keeperRewardSatoshis> OP_SUB',
  withdrawReserveSatoshis: '<reserveSatoshis> <minerFeeSatoshis> OP_SUB',
};

const notRelevant = { owner: { relevant: false }, keeper: { relevant: false } };
const paryonLock = (name: string, description: string, redeem: string) => ({
  name, description, icon: 'contract',
  lockingType: 'p2sh' as const,
  lockingBytecode: redeem,
  selectable: false,
  balance: { satoshis: 0n, fungibleTokens: 0n, nonfungibleTokens: 0 as const },
  roles: notRelevant,
});

export const backstopTemplate: XOTemplate = {
  $schema: 'https://libauth.org/schemas/wallet-template-v0.schema.json',
  name: 'Backstop',
  description: 'A safety net for a ParyonUSD loan: a BCH reserve that tops up the loan\'s collateral before liquidation. Anyone can send a rescue; only the owner can withdraw.',
  icon: 'shield',
  version: '1',
  supported: ['BCH_2025_05', 'BCH_2026_05'],

  resources: [
    { name: 'Backstop source', description: 'The covenant, its tests and the keeper.', url: 'https://github.com/Emediong-Etuk/Backstop' },
    { name: 'ParyonUSD contracts', description: 'The loan contracts a rescue adds collateral to.', url: 'https://github.com/ParyonUSD/contracts' },
  ],

  roles: {
    owner: { name: 'Borrower', description: 'The owner of the ParyonUSD loan. Sets up and withdraws the vault.', icon: 'user' },
    keeper: { name: 'Keeper', description: 'Anyone who sends a rescue. Needs no keys and no funds: fees come from the reserve, within the owner\'s limit.', icon: 'robot' },
  },

  start: [
    { action: 'protectLoan', role: 'owner', generate: ['ownerKey'] },
    { action: 'rescue', role: 'keeper' },
  ],

  actions: {
    protectLoan: {
      name: 'Protect my loan',
      description: 'Move your loan key and a BCH reserve into a Backstop vault. If your loan falls below $(<triggerRatioBps> <100> OP_DIV)% collateral, part of the reserve moves into it.',
      icon: 'shield',
      roles: {
        owner: {
          requirements: {
            secrets: ['ownerKey'],
            variables: [...VAULT_VARIABLES, 'reserveSatoshis'],
          },
        },
      },
      requirements: { participants: [{ role: 'owner', slots: { min: 1, max: 1 } }] },
      transaction: 'setupTransaction',
    },
    rescue: {
      name: 'Rescue a loan',
      description: 'Add $(<topUpSatoshis>) satoshis from a Backstop reserve to its ParyonUSD loan. The vault\'s covenant accepts only a correct rescue.',
      icon: 'lifebuoy',
      roles: {
        keeper: {
          requirements: {
            variables: [
              ...VAULT_VARIABLES, ...DEPLOYMENT_VARIABLES.filter((v) => v !== 'paryonTokenId'),
              'priceCommitment', 'loanSatoshis', 'loanCommitment', 'reserveSatoshis',
              'topUpSatoshis', 'minerFeeSatoshis', 'keeperRewardSatoshis', 'keeperLockingScript',
            ],
          },
        },
      },
      requirements: { participants: [{ role: 'keeper', slots: { min: 1, max: 1 } }] },
      transaction: 'rescueTransaction',
    },
    withdraw: {
      name: 'Withdraw everything',
      description: 'Take your loan key and the whole reserve back. Your loan will no longer be protected.',
      icon: 'withdraw',
      roles: {
        owner: {
          requirements: {
            secrets: ['ownerKey'],
            variables: [...VAULT_VARIABLES, 'reserveSatoshis', 'minerFeeSatoshis', 'returnLockingScript'],
          },
        },
      },
      requirements: { participants: [{ role: 'owner', slots: { min: 1, max: 1 } }] },
      transaction: 'withdrawTransaction',
    },
  },

  transactions: {
    setupTransaction: {
      name: 'Loan protected',
      description: 'Moved the loan key and $(<reserveSatoshis>) satoshis into a Backstop vault.',
      icon: 'shield',
      version: 2,
      locktime: 0,
      // The wallet adds coins to fund the reserve and a change output.
      inputs: [{ input: 'walletLoanKeyInput' }],
      outputs: [
        { output: 'vaultKeyOutput', outputIndex: 0 },
        { output: 'setupReserveOutput', outputIndex: 1 },
        { output: 'setupDataOutput', outputIndex: 2 },
      ],
      composable: true,
    },
    rescueTransaction: {
      name: 'Loan rescued',
      description: 'Added $(<topUpSatoshis>) satoshis from the reserve to the loan.',
      icon: 'lifebuoy',
      version: 2,
      locktime: 0,
      // Exactly Paryon's add-collateral layout plus the vault; the covenant refuses anything else.
      inputs: [
        { input: 'priceInput', inputIndex: 0 },
        { input: 'loanInput', inputIndex: 1 },
        { input: 'sidecarInput', inputIndex: 2 },
        { input: 'manageInput', inputIndex: 3 },
        { input: 'vaultKeyRescueInput', inputIndex: 4 },
        { input: 'vaultReserveRescueInput', inputIndex: 5 },
      ],
      outputs: [
        { output: 'priceOutput', outputIndex: 0 },
        { output: 'loanOutput', outputIndex: 1 },
        { output: 'sidecarOutput', outputIndex: 2 },
        { output: 'manageOutput', outputIndex: 3 },
        { output: 'vaultKeyOutput', outputIndex: 4 },
        { output: 'rescueReserveOutput', outputIndex: 5 },
        { output: 'keeperRewardOutput', outputIndex: 6 },
      ],
      composable: false,
    },
    withdrawTransaction: {
      name: 'Withdrawn',
      description: 'Took the loan key and the reserve back from the Backstop vault.',
      icon: 'withdraw',
      version: 2,
      locktime: 0,
      inputs: [
        { input: 'vaultKeyWithdrawInput', inputIndex: 0 },
        { input: 'vaultReserveWithdrawInput', inputIndex: 1 },
      ],
      outputs: [
        { output: 'returnKeyOutput', outputIndex: 0 },
        { output: 'returnReserveOutput', outputIndex: 1 },
      ],
      composable: false,
    },
  },

  inputs: {
    walletLoanKeyInput: {
      name: 'Loan key', description: 'The minting NFT that controls the ParyonUSD loan, from the owner\'s wallet.', icon: 'key',
      // Unlocked by the wallet that holds it.
      token: { category: '$(<loanKeyCategory>)', amount: 0n, nft: { capability: 'minting', commitment: '' } },
    },
    priceInput: {
      name: 'Paryon price contract', description: 'Shares the latest oracle price with the transaction.', icon: 'contract',
      valueSatoshis: 1000n, unlockingScript: 'unlockPriceShare',
      token: { category: '$(<paryonTokenId>)', amount: 0n, nft: { capability: 'mutable', commitment: '$(<priceCommitment>)' } },
    },
    loanInput: {
      name: 'ParyonUSD loan', description: 'The loan being topped up.', icon: 'contract',
      valueSatoshis: '$(<loanSatoshis>)', unlockingScript: 'unlockLoan',
      token: { category: '$(<paryonTokenId>)', amount: 0n, nft: { capability: 'mutable', commitment: '$(<loanCommitment>)' } },
    },
    sidecarInput: {
      name: 'Loan sidecar', description: 'Ties the loan to its loan key.', icon: 'contract',
      valueSatoshis: 1000n, unlockingScript: 'unlockSidecar',
      token: { category: '$(<loanKeyCategory>)', amount: 0n, nft: { capability: 'none', commitment: '01' } },
    },
    manageInput: {
      name: 'Paryon manage function', description: 'Paryon\'s add-collateral logic.', icon: 'contract',
      valueSatoshis: 1000n, unlockingScript: 'unlockManage',
      token: { category: '$(<paryonTokenId>)', amount: 0n, nft: { capability: 'none', commitment: '02' } },
    },
    vaultKeyRescueInput: {
      name: 'Vault: loan key', description: 'The loan key, lent to this rescue and returned unchanged.', icon: 'key',
      valueSatoshis: 1000n, unlockingScript: 'unlockVaultRescue',
      token: { category: '$(<loanKeyCategory>)', amount: 0n, nft: { capability: 'minting', commitment: '' } },
    },
    vaultReserveRescueInput: {
      name: 'Vault: reserve', description: 'The BCH reserve that funds the top-up and the capped fee.', icon: 'coins',
      valueSatoshis: '$(<reserveSatoshis>)', unlockingScript: 'unlockVaultRescue', token: null,
      // The covenant requires the reserve to be at least this many blocks old (relative timelock).
      sequenceNumber: '$(<cooldownBlocks>)',
    },
    vaultKeyWithdrawInput: {
      name: 'Vault: loan key', description: 'Your loan key, coming back.', icon: 'key',
      valueSatoshis: 1000n, unlockingScript: 'unlockVaultWithdraw',
      token: { category: '$(<loanKeyCategory>)', amount: 0n, nft: { capability: 'minting', commitment: '' } },
    },
    vaultReserveWithdrawInput: {
      name: 'Vault: reserve', description: 'Your reserve, coming back.', icon: 'coins',
      valueSatoshis: '$(<reserveSatoshis>)', unlockingScript: 'unlockVaultWithdraw', token: null,
    },
  },

  outputs: {
    vaultKeyOutput: {
      name: 'Vault: loan key', description: 'The loan key, held by the Backstop vault.', icon: 'key',
      lockingScript: 'vault', valueSatoshis: 1000n,
      token: { category: '$(<loanKeyCategory>)', amount: 0n, nft: { capability: 'minting', commitment: '' } },
    },
    setupReserveOutput: {
      name: 'Vault: reserve', description: '$(<reserveSatoshis>) satoshis kept ready for rescues.', icon: 'coins',
      lockingScript: 'vault', valueSatoshis: '$(<reserveSatoshis>)', token: null,
    },
    setupDataOutput: {
      name: 'Vault rules', description: 'The vault\'s rules, published so anyone can find and rescue it.', icon: 'info',
      lockingScript: 'setupData', valueSatoshis: 0n, token: null,
    },
    priceOutput: {
      name: 'Paryon price contract', description: 'Returned unchanged.', icon: 'contract',
      lockingScript: 'paryonPrice', valueSatoshis: 1000n,
      token: { category: '$(<paryonTokenId>)', amount: 0n, nft: { capability: 'mutable', commitment: '$(<priceCommitment>)' } },
    },
    loanOutput: {
      name: 'ParyonUSD loan', description: 'The loan, with $(<topUpSatoshis>) more satoshis of collateral.', icon: 'contract',
      lockingScript: 'paryonLoan', valueSatoshis: '$(rescueLoanSatoshis)',
      token: { category: '$(<paryonTokenId>)', amount: 0n, nft: { capability: 'mutable', commitment: '$(<loanCommitment>)' } },
    },
    sidecarOutput: {
      name: 'Loan sidecar', description: 'Returned unchanged.', icon: 'contract',
      lockingScript: 'paryonSidecar', valueSatoshis: 1000n,
      token: { category: '$(<loanKeyCategory>)', amount: 0n, nft: { capability: 'none', commitment: '01' } },
    },
    manageOutput: {
      name: 'Paryon manage function', description: 'Returned unchanged.', icon: 'contract',
      lockingScript: 'paryonManage', valueSatoshis: 1000n,
      token: { category: '$(<paryonTokenId>)', amount: 0n, nft: { capability: 'none', commitment: '02' } },
    },
    rescueReserveOutput: {
      name: 'Vault: reserve', description: 'What is left of the reserve after this rescue.', icon: 'coins',
      lockingScript: 'vault', valueSatoshis: '$(rescueReserveSatoshis)', token: null,
    },
    keeperRewardOutput: {
      name: 'Keeper reward', description: '$(<keeperRewardSatoshis>) satoshis for sending the rescue.', icon: 'coins',
      lockingScript: 'keeperReward', valueSatoshis: '$(<keeperRewardSatoshis>)', token: null,
      roles: { owner: { relevant: false } },
    },
    returnKeyOutput: {
      name: 'Loan key', description: 'Your loan key, back in your wallet.', icon: 'key',
      lockingScript: 'ownerReturn', valueSatoshis: 1000n,
      token: { category: '$(<loanKeyCategory>)', amount: 0n, nft: { capability: 'minting', commitment: '' } },
    },
    returnReserveOutput: {
      name: 'Reserve', description: 'Your reserve, back in your wallet.', icon: 'coins',
      lockingScript: 'ownerReturn', valueSatoshis: '$(withdrawReserveSatoshis)', token: null,
    },
  },

  lockingScripts: {
    vault: {
      name: 'Backstop vault',
      description: 'Holds the loan key and the reserve. Anyone may rescue the loan with it; only the owner may withdraw.',
      icon: 'shield',
      lockingType: 'p2sh',
      lockingBytecode: 'backstopRedeem',
      selectable: false,
      roles: {
        owner: {
          state: { variables: VAULT_VARIABLES, secrets: ['ownerKey'] },
          actions: [{ action: 'withdraw', role: 'owner', secrets: [{ ownerKey: null }] }],
          balance: { satoshis: true },
        },
        keeper: {
          state: { variables: VAULT_VARIABLES },
          actions: [{ action: 'rescue', role: 'keeper' }],
          balance: { satoshis: 0n },
        },
      },
    },
    paryonPrice: paryonLock('Paryon price contract', 'Paryon\'s on-chain BCH/USD price, updated from signed oracle messages.', 'paryonPriceRedeem'),
    paryonLoan: paryonLock('ParyonUSD loan', 'A Paryon loan: its BCH collateral and its 27-byte state.', 'paryonLoanRedeem'),
    paryonSidecar: paryonLock('Loan sidecar', 'Carries the loan key category next to its loan.', 'paryonSidecarRedeem'),
    paryonManage: paryonLock('Paryon manage function', 'Paryon\'s repay / add / remove collateral logic.', 'paryonManageRedeem'),
    setupData: {
      name: 'Vault rules', description: 'OP_RETURN with the vault\'s parameters.', icon: 'info',
      lockingType: 'p2s', lockingBytecode: 'setupOpReturn', selectable: false, roles: notRelevant,
    },
    keeperReward: {
      name: 'Keeper reward', description: 'Where the keeper wants its reward.', icon: 'coins',
      lockingType: 'p2s', lockingBytecode: 'keeperRewardLocking', selectable: false, roles: { owner: { relevant: false } },
    },
    ownerReturn: {
      name: 'Your wallet', description: 'Where the loan key and reserve go on withdraw.', icon: 'user',
      lockingType: 'p2s', lockingBytecode: 'ownerReturnLocking', selectable: false,
    },
  },

  scripts,

  variables: {
    ownerKey: { name: 'Vault owner key', description: 'The key that may withdraw from the vault.', type: 'private_key' },
    ownerPkh: { name: 'Owner key hash', description: 'HASH160 of the vault owner key\'s public key (20 bytes). Must match ownerKey for withdraw to work.', type: 'bytes' },
    loanKeyCategory: { name: 'Loan key', description: 'Token category of the ParyonUSD loan key (display order).', type: 'token_category' },
    paryonTokenId: { name: 'Paryon token category', description: 'Paryon\'s token category on this network (display order).', type: 'token_category' },
    oraclePublicKey: { name: 'Oracle key', description: 'Public key the Paryon price contract accepts.', type: 'public_key' },
    migrationKeyCategory: { name: 'Price contract migration key', description: 'Migration-key category the price contract was built with (display order).', type: 'token_category' },
    triggerRatioBps: { name: 'Rescue level', description: 'A rescue is allowed while the loan\'s collateral ratio is below this, in basis points (12500 = 125%).', type: 'integer' },
    targetRatioBps: { name: 'Target level', description: 'A rescue may lift the loan to at most this ratio, in basis points (15000 = 150%).', type: 'integer' },
    maxTopUpSatoshis: { name: 'Most per rescue', description: 'Most satoshis one rescue may move into the loan.', type: 'satoshis' },
    maxOverheadSatoshis: { name: 'Fee limit', description: 'Most satoshis one rescue may spend on miner fee plus keeper reward.', type: 'satoshis' },
    cooldownBlocks: { name: 'Time between rescues', description: 'Blocks the reserve must age before it can fund another rescue.', type: 'integer' },
    reserveSatoshis: { name: 'Reserve', description: 'Satoshis in the vault reserve.', type: 'satoshis' },
    priceCommitment: { name: 'Price contract state', description: 'Current state of the Paryon price contract thread used (9 bytes).', type: 'bytes' },
    loanSatoshis: { name: 'Loan collateral', description: 'Satoshis currently in the loan.', type: 'satoshis' },
    loanCommitment: { name: 'Loan state', description: 'The loan\'s 27-byte state, which must stay unchanged.', type: 'bytes' },
    topUpSatoshis: { name: 'Top-up', description: 'Satoshis this rescue moves into the loan.', type: 'satoshis' },
    minerFeeSatoshis: { name: 'Network fee', description: 'Satoshis paid to miners.', type: 'satoshis' },
    keeperRewardSatoshis: { name: 'Keeper reward', description: 'Satoshis the keeper takes for sending the rescue.', type: 'satoshis' },
    keeperLockingScript: { name: 'Keeper address', description: 'Where the keeper reward goes.', type: 'locking_script' },
    returnLockingScript: { name: 'Your address', description: 'Where the loan key and reserve go on withdraw.', type: 'locking_script' },
  },
};
