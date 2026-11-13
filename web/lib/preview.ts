// LOCAL PREVIEW: a throwaway in-memory chain inside the page (mem-cash), with our demo deployment
// of Paryon's contracts, one demo loan and a test wallet. Nothing touches a real network. It lets
// anyone try the app (and lets us test it) without a wallet, chipnet coins or a WalletConnect ID.
import { binToHex, sha256, utf8ToBin } from '@bitauth/libauth';
import {
  assemble, ATTACKS, attackParts, findOwnedVaults, findRescueUtxos, paryonContracts, paryonUnlockers, refusalOf, rescueParts, utxoAgeBlocks,
  type AttackKind,
} from '@backstop/contracts';
import { scanOnce } from '@backstop/keeper/scan';
import { deployDemo, MemCashProvider, newWallet, publishDemoPrice } from '@backstop/demo';
import type { Chain } from './chain';
import type { WalletSession } from './wallet';

const BCH = 100_000_000n;

export interface PreviewControls {
  setPrice(priceCents: bigint): Promise<void>;
  mine(blocks?: number): Promise<void>;
  runKeeper(): Promise<string[]>;
  /** A malicious keeper tries one attack. Nothing is changed unless the covenant would accept it (it never should). */
  attack(kind: AttackKind): Promise<AttackResult>;
}

export interface AttackResult {
  kind: AttackKind;
  refused: boolean;
  /** The require that refused it, as the contract states it. */
  message: string;
  line?: number;
  /** What the node said when the transaction was submitted anyway. */
  node: string;
}

export async function startPreview(): Promise<{ chain: Chain; wallet: WalletSession; controls: PreviewControls }> {
  const provider = new MemCashProvider();
  const [funder, oracle, borrower, keeper] = [newWallet(), newWallet(), newWallet(), newWallet()];
  const coin = (label: string) => binToHex(sha256.hash(utf8ToBin(`preview ${label} ${Math.random()}`)));
  provider.addUtxo(funder.lockingBytecode, { txid: coin('funder'), vout: 0, satoshis: 2n * BCH });
  provider.addUtxo(borrower.lockingBytecode, { txid: coin('borrower'), vout: 0, satoshis: 1n * BCH });

  // One demo loan: 0.5 BCH collateral, $115 borrowed, at $300 per BCH (130%).
  const deployment = await deployDemo({
    provider, funder, oracle, startPriceCents: 30_000n, log: () => {},
    loans: [{ collateralSats: BCH / 2n, debtCents: 11_500n, borrowerLockingBytecode: borrower.lockingBytecode }],
  });
  provider.mine();

  const chain: Chain = { kind: 'preview', provider, deployment, paryon: paryonContracts(provider, deployment) };
  const wallet: WalletSession = {
    kind: 'preview', label: 'Preview wallet', address: borrower.address, lockingBytecode: borrower.lockingBytecode, pkh: borrower.pkh,
    addresses: [{ address: borrower.address, lockingBytecode: borrower.lockingBytecode, pkh: borrower.pkh }],
    localSigner: borrower.signer, disconnect: async () => {},
  };
  const controls: PreviewControls = {
    async setPrice(priceCents) {
      await publishDemoPrice({ provider, deployment, oracle, funder, priceCents, log: () => {} });
      provider.mine();
    },
    async mine(blocks = 1) {
      provider.mine(blocks);
    },
    async runKeeper() {
      const vaults = await findOwnedVaults(provider, borrower.pkh, borrower.lockingBytecode);
      const lines: string[] = [];
      await scanOnce({
        provider, deployment, setupTxids: vaults.map((v) => v.setupTxid), dryRun: false,
        keeperRewardSats: 2_000n, keeperLockingBytecode: keeper.lockingBytecode, log: (l) => lines.push(l),
      });
      provider.mine();
      return lines.length ? lines : ['No vaults to check yet.'];
    },
    async attack(kind) {
      const [vault] = (await findOwnedVaults(provider, borrower.pkh, borrower.lockingBytecode)).slice(-1);
      if (!vault) throw new Error('Protect the loan first, then try to break the vault.');
      const lookup = await findRescueUtxos(provider, chain.paryon, deployment, vault);
      if (!lookup.found) throw new Error(`There is no vault to attack: ${lookup.reason}`);
      // Let the cooldown pass, so the attack meets the rule it targets rather than the cooldown.
      const age = await utxoAgeBlocks(provider, lookup.utxos.reserve);
      if (age !== undefined && age < Number(vault.params.cooldownBlocks)) provider.mine(Number(vault.params.cooldownBlocks) - age);
      const fresh = await findRescueUtxos(provider, chain.paryon, deployment, vault);
      if (!fresh.found) throw new Error(fresh.reason);
      const { utxos } = fresh;
      const room = utxos.reserve.satoshis - vault.params.maxOverheadSats - 2_000n;
      const topUpSats = vault.params.maxTopUpSats < room ? vault.params.maxTopUpSats : room;
      const honest = rescueParts({
        vault: vault.contract, params: vault.params, utxos, unlockers: paryonUnlockers(chain.paryon, utxos.loan),
        topUpSats, minerFeeSats: 3_000n,
      });
      const builder = assemble(provider, attackParts(kind, honest, keeper.lockingBytecode, vault.params.maxOverheadSats));
      let refusal: ReturnType<typeof refusalOf> | undefined;
      try { builder.debug(); } catch (e) { refusal = refusalOf(e); }
      if (!refusal) {
        // Never expected. Do not broadcast something the covenant would accept as an attack.
        return { kind, refused: false, message: `The covenant did not refuse "${ATTACKS[kind].title}".`, node: 'not submitted' };
      }
      let node = 'accepted';
      try { await provider.sendRawTransaction(builder.build()); } catch (e) { node = (e as Error).message.split('\n')[0]; }
      return { kind, refused: true, message: refusal.message, line: refusal.line, node };
    },
  };
  return { chain, wallet, controls };
}
