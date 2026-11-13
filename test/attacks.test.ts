// The attacks the web app's preview lets anyone try. Each is a correct rescue with one malicious
// change; the covenant must refuse it with the named require, and the node must reject it.
import { describe, expect, it } from 'vitest';
import { binToHex, sha256, utf8ToBin } from '@bitauth/libauth';
import {
  assemble, ATTACKS, attackParts, findRescueUtxos, loadVault, paryonContracts, paryonUnlockers, refusalOf, rescueParts, type AttackKind,
} from '@backstop/contracts';
import { deployDemo, MemCashProvider, publishDemoPrice, setUpDemoVault, walletFromPrivateKey } from '@backstop/demo';

const BCH = 100_000_000n;
const wallet = (label: string) => walletFromPrivateKey(sha256.hash(utf8ToBin(`backstop attacks test: ${label}`)));
const [oracle, funder, borrower, attacker] = ['oracle', 'funder', 'borrower', 'attacker'].map(wallet);

async function vaultBelowTrigger() {
  const provider = new MemCashProvider();
  provider.addUtxo(funder.lockingBytecode, { txid: binToHex(sha256.hash(utf8ToBin('f'))), vout: 0, satoshis: 2n * BCH });
  provider.addUtxo(borrower.lockingBytecode, { txid: binToHex(sha256.hash(utf8ToBin('b'))), vout: 0, satoshis: 1n * BCH });
  const deployment = await deployDemo({
    provider, funder, oracle, startPriceCents: 30_000n, log: () => {},
    loans: [{ collateralSats: BCH / 2n, debtCents: 11_500n, borrowerLockingBytecode: borrower.lockingBytecode }],
  });
  provider.mine();
  const { setupTxid } = await setUpDemoVault({ provider, deployment, borrower, loanKeyCategory: deployment.demo.loans[0].loanKeyCategory, reserveSats: 3n * BCH / 10n, cooldownBlocks: 1n });
  provider.mine();
  await publishDemoPrice({ provider, deployment, oracle, funder, priceCents: 26_500n, log: () => {} });
  provider.mine();
  const paryon = paryonContracts(provider, deployment);
  const vault = await loadVault(provider, setupTxid);
  const lookup = await findRescueUtxos(provider, paryon, deployment, vault);
  if (!lookup.found) throw new Error(lookup.reason);
  const honest = rescueParts({
    vault: vault.contract, params: vault.params, utxos: lookup.utxos, unlockers: paryonUnlockers(paryon, lookup.utxos.loan),
    topUpSats: 10_000_000n, minerFeeSats: 3_000n,
  });
  return { provider, vault, honest };
}

describe('Attacks a judge can try in the preview', () => {
  for (const kind of Object.keys(ATTACKS) as AttackKind[]) {
    it(`refuses "${ATTACKS[kind].title}" with Backstop's own require, and the node rejects it`, async () => {
      const { provider, vault, honest } = await vaultBelowTrigger();
      const builder = assemble(provider, attackParts(kind, honest, attacker.lockingBytecode, vault.params.maxOverheadSats));
      let caught: unknown;
      try { builder.debug(); } catch (e) { caught = e; }
      expect(caught, 'the covenant must refuse it').toBeDefined();
      const refusal = refusalOf(caught);
      expect(refusal.message).toBe(ATTACKS[kind].expectedRequire);
      expect(refusal.line).toBeGreaterThan(0);
      await expect(provider.sendRawTransaction(builder.build())).rejects.toThrow();
    });
  }

  it('the same rescue without the malicious change is accepted', async () => {
    const { provider, honest } = await vaultBelowTrigger();
    const builder = assemble(provider, honest);
    builder.debug();
    expect(await provider.sendRawTransaction(builder.build())).toMatch(/^[0-9a-f]{64}$/);
  });
});
