// Attacks a malicious keeper could try, for showing the covenant refuse them (web app preview,
// tests). Each one starts from a correct rescue and changes one thing. They are never broadcast
// by the keeper; the preview evaluates them and lets the node reject them.
import { hexToBin } from '@bitauth/libauth';
import type { Output } from 'cashscript';
import type { TransactionParts } from './transactions.js';

export type AttackKind = 'steal-reserve' | 'overcharge' | 'copy-key';

export const ATTACKS: Record<AttackKind, { title: string; what: string; expectedRequire: string; paryonAlone: string }> = {
  'steal-reserve': {
    title: 'Steal the reserve',
    what: 'A keeper builds a rescue but sends what is left of the reserve to itself.',
    expectedRequire: 'Remaining reserve must return to the vault',
    paryonAlone: "Paryon's contracts do not look at this output.",
  },
  overcharge: {
    title: 'Overcharge the fee',
    what: "A keeper pays itself a reward far above the borrower's fee cap, out of the reserve.",
    expectedRequire: "Fee and keeper reward exceed the vault's limit",
    paryonAlone: "Paryon's contracts do not look at the reserve.",
  },
  'copy-key': {
    title: 'Copy the loan key',
    what: "The loan key is a minting NFT, so a rescue could mint a second key and give the keeper control of the loan.",
    expectedRequire: 'Keeper reward must hold no tokens',
    paryonAlone: "Paryon's contracts accept this transaction.",
  },
};

/**
 * Turns a correct rescue (with no keeper reward) into one of the attacks. `attacker` is the
 * locking bytecode that would profit.
 */
export function attackParts(kind: AttackKind, honest: TransactionParts, attacker: string, maxOverheadSats: bigint): TransactionParts {
  const outputs: Output[] = honest.outputs.map((o) => ({ ...o }));
  const reserve = outputs[5];
  const key = honest.inputs[4].utxo;
  switch (kind) {
    case 'steal-reserve':
      outputs[5] = { ...reserve, to: hexToBin(attacker) };
      break;
    case 'overcharge': {
      const reward = maxOverheadSats + 50_000n;
      outputs[5] = { ...reserve, amount: reserve.amount - reward };
      outputs.push({ to: hexToBin(attacker), amount: reward });
      break;
    }
    case 'copy-key':
      outputs[5] = { ...reserve, amount: reserve.amount - 1_000n };
      outputs.push({
        to: hexToBin(attacker), amount: 1_000n,
        token: { category: key.token!.category, amount: 0n, nft: { capability: 'minting', commitment: '' } },
      });
      break;
  }
  return { inputs: honest.inputs, outputs };
}

/** Pulls the failing require's message and line out of a CashScript evaluation error. */
export function refusalOf(error: unknown): { message: string; line?: number; contract?: string } {
  const text = (error as Error)?.message ?? String(error);
  const message = text.match(/with the following message: (.+?)\.?\s*(?:\n|Failing statement|$)/)?.[1]
    ?? text.match(/require\([^,]+,\s*"([^"]+)"\)/)?.[1]
    ?? text.split('\n')[0];
  const line = Number(text.match(/at line (\d+)/)?.[1]) || undefined;
  const contract = text.match(/in contract ([\w.]+)/)?.[1];
  return { message, line, contract };
}
