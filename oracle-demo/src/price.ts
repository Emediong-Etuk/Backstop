// Publishes a DEMO oracle price into Paryon's price contract on the demo deployment.
// This is the same updatePrice transaction anyone can send on mainnet with a real General
// Protocols message; only the signing key differs.
import { TransactionBuilder, type NetworkProvider, type SpendableUtxo } from 'cashscript';
import { hexToBin } from '@bitauth/libauth';
import { encodePriceState, PARYON_DUST, parsePriceState } from '@backstop/contracts';
import { deploymentContracts, type Deployment } from '@backstop/keeper';
import { nextHeartbeatSequence, signDemoPrice } from './oracle.js';
import { pickCoins, type DemoWallet } from './wallet.js';

export async function priceThreads(provider: NetworkProvider, deployment: Deployment): Promise<SpendableUtxo[]> {
  const paryon = deploymentContracts(provider, deployment);
  return (await provider.getUtxosForLockingBytecode(paryon.price.lockingBytecode))
    .filter((u) => u.token?.category === deployment.paryonTokenId && u.token.nft?.capability === 'mutable' && u.token.nft.commitment.startsWith('00'));
}

export async function publishDemoPrice(args: {
  provider: NetworkProvider;
  deployment: Deployment;
  oracle: DemoWallet;
  funder: DemoWallet;
  priceCents: bigint;
  feeRate?: number;
  log?: (line: string) => void;
}): Promise<Array<{ txid: string; fromCents: bigint; toCents: bigint; sequence: bigint }>> {
  const { provider, deployment, oracle, funder, priceCents } = args;
  const log = args.log ?? console.log;
  const paryon = deploymentContracts(provider, deployment);
  const threads = await priceThreads(provider, deployment);
  if (threads.length === 0) throw new Error('no price contract found for this deployment');

  const results = [];
  // Every price thread is updated, so no keeper can pick a stale one.
  for (const thread of threads) {
    const current = parsePriceState(thread.token!.nft!.commitment);
    const sequence = nextHeartbeatSequence(current.sequence);
    const signed = await signDemoPrice(oracle, { priceCents, dataSequence: sequence });
    const [fee] = await pickCoins(provider, funder, 5_000n, 'Funder');
    const builder = new TransactionBuilder({ provider })
      .addInput(thread, paryon.price.unlock.updatePrice(signed.message, signed.signature))
      .addInput(fee, funder.signer.unlockP2PKH())
      .addOutput({ to: hexToBin(thread.lockingBytecode), amount: PARYON_DUST, token: { ...thread.token!, nft: { capability: 'mutable', commitment: encodePriceState({ sequence, priceCents }) } } })
      .addBchChangeOutputIfNeeded({ to: funder.address, feeRate: args.feeRate ?? 1.1 });
    const { txid } = await builder.send();
    log(`price ${formatCents(current.priceCents)} -> ${formatCents(priceCents)} (sequence ${sequence}) in ${txid}`);
    results.push({ txid, fromCents: current.priceCents, toCents: priceCents, sequence });
  }
  return results;
}

const formatCents = (cents: bigint) => `$${(Number(cents) / 100).toFixed(2)}`;
