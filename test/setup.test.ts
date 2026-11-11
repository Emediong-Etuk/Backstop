// Setting up a vault, and finding it again from chain data alone (no registry, no database).
import { describe, expect, it } from 'vitest';
import { binToHex, decodeTransaction, hexToBin } from '@bitauth/libauth';
import { buildSetup, decodeSetupOutput, decodeSetupPayload, encodeSetupPayload, setupParts, vaultContract, PARYON_DUST } from '@backstop/contracts';
import { createWorld, DEFAULTS, owner } from './harness.js';

function setUp() {
  const world = createWorld({ beforeSetup: true });
  const parts = setupParts({
    vault: world.vault,
    params: world.params,
    keyUtxo: world.utxos.key,
    fundingUtxos: [world.utxos.reserve],
    ownerSigner: owner.signer,
    reserveSats: DEFAULTS.reserveSats,
    minerFeeSats: 1_500n,
    changeLockingBytecode: owner.lockingBytecode,
  });
  return { world, parts, builder: buildSetup(world.provider, parts) };
}

describe('Setting up a vault', () => {
  it('moves the loan key and the reserve into the vault in one transaction, signed by the borrower', async () => {
    const { world, parts, builder } = setUp();
    // Every input is a borrower wallet coin, all signed by the one owner key.
    expect(parts.inputs.every((i) => i.utxo.lockingBytecode === owner.lockingBytecode)).toBe(true);
    const { txid } = await builder.send();

    const vaultUtxos = await world.provider.getUtxosForLockingBytecode(world.vault.lockingBytecode);
    const key = vaultUtxos.find((u) => u.txid === txid && u.vout === 0);
    const reserve = vaultUtxos.find((u) => u.txid === txid && u.vout === 1);
    expect(key?.token).toEqual(world.utxos.key.token);
    expect(key?.satoshis).toBe(PARYON_DUST);
    expect(reserve?.satoshis).toBe(DEFAULTS.reserveSats);
    expect(reserve?.token).toBeUndefined();
  });

  it("publishes the vault's rules in the setup transaction, so a keeper can rebuild the vault from chain data alone", async () => {
    const { world, builder } = setUp();
    const { txid } = await builder.send();

    // A keeper that knows only the transaction:
    const tx = decodeTransaction(hexToBin(await world.provider.getRawTransaction(txid)));
    if (typeof tx === 'string') throw new Error(tx);
    const found = tx.outputs.map((o) => decodeSetupOutput(binToHex(o.lockingBytecode))).filter((p) => p !== undefined);
    expect(found).toHaveLength(1);
    expect(found[0]).toEqual(world.params);

    const rebuilt = vaultContract(found[0]!, world.provider);
    expect(rebuilt.lockingBytecode).toBe(world.vault.lockingBytecode);
    expect(binToHex(tx.outputs[0].lockingBytecode)).toBe(rebuilt.lockingBytecode);
  });

  it('keeps the OP_RETURN within the standard relay size', () => {
    const { world } = setUp();
    const payloadBytes = encodeSetupPayload(world.params).length / 2;
    // OP_RETURN (1) + push "BKSP" (1 + 4) + OP_PUSHDATA1 payload (2 + payload) must stay within 223 bytes.
    expect(1 + 5 + 2 + payloadBytes).toBeLessThanOrEqual(223);
  });

  it('rejects setup data that has been tampered with or truncated', () => {
    const payload = encodeSetupPayload(createWorld().params);
    expect(() => decodeSetupPayload(payload.slice(0, -2))).toThrow();
    expect(() => decodeSetupPayload(payload + '00')).toThrow();
    expect(() => decodeSetupPayload('02' + payload.slice(2))).toThrow(/version/);
  });
});
