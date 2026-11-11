// The XO template (xo/src/template.ts) checked offline with XO's own tools:
// - @xo-cash/utils parseTemplate for the template schema,
// - a reference check (parseTemplate only checks shape),
// - @xo-cash/utils compileCashAssemblyString for every script, with variables converted the way
//   @xo-cash/engine converts them, compared byte for byte with what CashScript builds and the
//   tests above prove valid.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bigIntToVmNumber, binToHex, decodeAuthenticationInstructions, decodeTransaction, hexToBin, isHex, vmNumberToBigInt } from '@bitauth/libauth';
import { collectVariablesUsingParseScript, compileCashAssemblyString, parseTemplate, serializeTemplate } from '@xo-cash/utils';
import { decodeSetupOutput, readRescueState, withdrawParts } from '@backstop/contracts';
import { backstopTemplate as template } from '@backstop/xo';
import { createWorld, DEFAULTS, demoOracle, keeper, MIGRATION_KEY_CATEGORY, owner, PARYON_TOKEN_ID } from './harness.js';

/** Same conversion as convertInvitationVariableValueForCompiler in @xo-cash/engine. */
function asEngineBytes(value: bigint | string): Uint8Array {
  if (typeof value === 'bigint') return bigIntToVmNumber(value);
  const text = value.startsWith('0x') ? value.slice(2) : value;
  if (isHex(text)) return hexToBin(text);
  throw new Error(`not hex: ${value}`);
}

function compile(text: string, values: Record<string, bigint | string>): string {
  const variables = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, asEngineBytes(v)]));
  return compileCashAssemblyString({
    cashAssemblyText: text, variables, templateVariables: template.variables, templateScripts: template.scripts, evaluationDecodeMode: 'hex',
  });
}

/** Template variable values for the default test world's vault and rescue. */
function worldValues() {
  const world = createWorld({ mode: 'paryon' });
  const p = world.params;
  const topUp = world.plannedTopUp();
  const values = {
    ownerPkh: p.ownerPkh, loanKeyCategory: p.loanKeyCategory, paryonTokenId: p.paryonTokenId,
    triggerRatioBps: p.triggerRatioBps, targetRatioBps: p.targetRatioBps, maxTopUpSatoshis: p.maxTopUpSats,
    maxOverheadSatoshis: p.maxOverheadSats, cooldownBlocks: p.cooldownBlocks,
    oraclePublicKey: binToHex(demoOracle.publicKey), migrationKeyCategory: MIGRATION_KEY_CATEGORY,
    priceCommitment: world.utxos.price.token!.nft!.commitment, loanCommitment: world.utxos.loan.token!.nft!.commitment,
    loanSatoshis: world.utxos.loan.satoshis, reserveSatoshis: world.utxos.reserve.satoshis,
    topUpSatoshis: topUp, minerFeeSatoshis: DEFAULTS.minerFeeSats, keeperRewardSatoshis: DEFAULTS.keeperRewardSats,
    keeperLockingScript: keeper.lockingBytecode, returnLockingScript: owner.lockingBytecode,
  };
  return { world, values, topUp };
}

/** Unlocking bytecode of each input of a transaction built by CashScript. */
function unlockingBytecodes(txHex: string): string[] {
  const tx = decodeTransaction(hexToBin(txHex));
  if (typeof tx === 'string') throw new Error(tx);
  return tx.inputs.map((i) => binToHex(i.unlockingBytecode));
}

describe('XO template', () => {
  it('passes the XO template schema, also after a round trip through its JSON form', () => {
    expect(() => parseTemplate(template)).not.toThrow();
    expect(() => parseTemplate(serializeTemplate(template))).not.toThrow();
  });

  it('is exported to xo/backstop.template.json exactly as defined (run npm run xo:export after changes)', () => {
    const committed = readFileSync(new URL('../xo/backstop.template.json', import.meta.url), 'utf8');
    expect(committed).toBe(serializeTemplate(template));
  });

  it('refers only to scripts, inputs, outputs, locking scripts, transactions and variables it defines', () => {
    const missing: string[] = [];
    const need = (kind: string, id: string | undefined, table: Record<string, unknown> | undefined) => {
      if (id !== undefined && !(table && id in table)) missing.push(`${kind} ${id}`);
    };
    for (const start of template.start) need('action', start.action, template.actions);
    for (const action of Object.values(template.actions)) need('transaction', action.transaction, template.transactions);
    for (const tx of Object.values(template.transactions ?? {})) {
      tx.inputs.forEach((i) => need('input', i.input, template.inputs));
      tx.outputs.forEach((o) => need('output', o.output, template.outputs));
    }
    for (const input of Object.values(template.inputs)) need('script', input.unlockingScript, template.scripts);
    for (const output of Object.values(template.outputs)) need('locking script', output.lockingScript, template.lockingScripts);
    for (const lock of Object.values(template.lockingScripts)) {
      need('script', lock.lockingBytecode, template.scripts);
      for (const role of Object.values(lock.roles ?? {})) for (const a of role.actions ?? []) need('action', a.action, template.actions);
    }
    // Every variable a script or a $() expression reads must be declared.
    const expressions = [
      ...Object.values(template.scripts),
      ...JSON.stringify(serializeTemplate(template)).match(/\$\(([^()]|\([^()]*\))*\)/g) ?? [],
    ];
    for (const expression of expressions) {
      for (const name of collectVariablesUsingParseScript(expression, template.scripts)) {
        need('variable', name.split('.')[0], { ...template.variables, ...template.constants });
      }
    }
    expect(missing).toEqual([]);
  });

  it('locks the vault to exactly the contract CashScript builds and the tests cover', () => {
    const { world, values } = worldValues();
    const redeem = compile('backstopRedeem', values);
    expect(redeem).toBe(world.vault.bytecode);
    // P2SH32: OP_HASH256 <hash256(redeem)> OP_EQUAL
    expect(`aa20${compile('$(<backstopRedeem> OP_HASH256)', values)}87`).toBe(world.vault.lockingBytecode);
  });

  it("uses Paryon's unmodified contracts at their real addresses", () => {
    const { world, values } = worldValues();
    expect(compile('paryonPriceRedeem', values)).toBe(world.paryon.price.bytecode);
    expect(compile('paryonLoanRedeem', values)).toBe(world.paryon.loan.bytecode);
    expect(compile('paryonSidecarRedeem', values)).toBe(world.paryon.sidecar.bytecode);
    expect(compile('paryonManageRedeem', values)).toBe(world.paryon.manage.bytecode);
    expect(compile('paryonManageLocking', values)).toBe(world.paryon.manage.lockingBytecode);
    expect(values.paryonTokenId).toBe(PARYON_TOKEN_ID);
  });

  it('publishes the same setup OP_RETURN, which a keeper decodes back into the vault rules', () => {
    const { world, values } = worldValues();
    expect(decodeSetupOutput(compile('setupOpReturn', values))).toEqual(world.params);
  });

  it('unlocks every rescue input with exactly the bytes of a rescue the covenant accepts', async () => {
    const { world, values, topUp } = worldValues();
    const builder = world.build(world.rescue({ topUpSats: topUp }));
    const expected = unlockingBytecodes(builder.build());
    const fromTemplate = ['unlockPriceShare', 'unlockLoan', 'unlockSidecar', 'unlockManage', 'unlockVaultRescue', 'unlockVaultRescue']
      .map((script) => compile(script, values));
    expect(fromTemplate).toEqual(expected);
    await builder.send(); // and that transaction is valid
  });

  it('computes the same rescue amounts the keeper uses', () => {
    const { world, values, topUp } = worldValues();
    const parts = world.rescue({ topUpSats: topUp });
    expect(compileNumber('rescueLoanSatoshis', values)).toBe(parts.outputs[1].amount);
    expect(compileNumber('rescueReserveSatoshis', values)).toBe(parts.outputs[5].amount);
    expect(readRescueState(world.utxos).reserveSats).toBe(values.reserveSatoshis);
  });

  it('withdraws with the owner signature followed by exactly the bytes CashScript uses for ownerSpend', () => {
    const { world, values } = worldValues();
    const parts = withdrawParts({ vault: world.vault, key: world.utxos.key, reserve: world.utxos.reserve, ownerSigner: owner.signer, minerFeeSats: 2_000n, toLockingBytecode: owner.lockingBytecode });
    const [cashScript] = unlockingBytecodes(world.build(parts).build());
    // The template's unlockVaultWithdraw is <signature> <public key> <1> <backstopRedeem>.
    // The compiler here has no signing context, so compare everything after the signature and key.
    const instructions = decodeAuthenticationInstructions(hexToBin(cashScript));
    const afterKey = binToHex(hexToBin(cashScript).slice(1 + 65 + 1 + 33));
    expect(instructions).toHaveLength(4);
    expect(afterKey).toBe(compile('<1> <backstopRedeem>', values));
    expect(template.scripts.unlockVaultWithdraw).toBe('<ownerKey.schnorr_signature.all_outputs> <ownerKey.public_key> <1> <backstopRedeem>');
    expect(compileNumber('withdrawReserveSatoshis', { reserveSatoshis: values.reserveSatoshis, minerFeeSatoshis: 2_000n })).toBe(parts.outputs[1].amount);
  });
});

/** Evaluates an amount script and reads the resulting VM number. */
function compileNumber(script: string, values: Record<string, bigint | string>): bigint {
  const result = vmNumberToBigInt(hexToBin(compile(`$(${script})`, values)));
  if (typeof result === 'string') throw new Error(result);
  return result;
}
