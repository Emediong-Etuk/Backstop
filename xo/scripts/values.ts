// Prints the XO template variable values for a real vault, read from chain, ready to paste into
// the XO debug tool. Usage (chipnet, needs network):
//   npm run xo:values -- <setup txid> [rescue|withdraw]
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { ElectrumNetworkProvider, Network } from 'cashscript';
import { deploymentContracts, findRescueUtxos, loadVault, planRescue, readRescueState, type Deployment } from '@backstop/contracts';

const [setupTxid, action = 'rescue'] = process.argv.slice(2);
if (!setupTxid) throw new Error('usage: npm run xo:values -- <setup txid> [rescue|withdraw]');
const deployment = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../deployments/chipnet.json'), 'utf8')) as Deployment;
const provider = new ElectrumNetworkProvider(Network.CHIPNET);
const vault = await loadVault(provider, setupTxid);
const lookup = await findRescueUtxos(provider, deploymentContracts(provider, deployment), deployment, vault);
if (!lookup.found) throw new Error(lookup.reason);
const p = vault.params;
const values: Record<string, string> = {
  ownerPkh: p.ownerPkh, loanKeyCategory: p.loanKeyCategory, paryonTokenId: p.paryonTokenId,
  triggerRatioBps: String(p.triggerRatioBps), targetRatioBps: String(p.targetRatioBps),
  maxTopUpSatoshis: String(p.maxTopUpSats), maxOverheadSatoshis: String(p.maxOverheadSats), cooldownBlocks: String(p.cooldownBlocks),
  reserveSatoshis: String(lookup.utxos.reserve.satoshis),
};
if (action === 'rescue') {
  const minerFee = 3_000n, reward = 2_000n;
  const plan = planRescue({ params: p, ...readRescueState(lookup.utxos), overheadSats: minerFee + reward });
  if (!plan.ok) console.error(`Note: a rescue is not possible right now (${plan.reason}); values are shown anyway.`);
  Object.assign(values, {
    oraclePublicKey: deployment.oraclePublicKey, migrationKeyCategory: deployment.migrationKeyCategory,
    priceCommitment: lookup.utxos.price.token!.nft!.commitment, loanSatoshis: String(lookup.utxos.loan.satoshis),
    loanCommitment: lookup.utxos.loan.token!.nft!.commitment, topUpSatoshis: String(plan.ok ? plan.topUpSats : 0n),
    minerFeeSatoshis: String(minerFee), keeperRewardSatoshis: String(reward), keeperLockingScript: '<your locking bytecode, hex>',
  });
  console.log('Inputs (outpoints):', JSON.stringify(Object.fromEntries(Object.entries(lookup.utxos).map(([k, u]) => [k, `${u.txid}:${u.vout}`])), null, 2));
} else {
  Object.assign(values, { minerFeeSatoshis: '2000', returnLockingScript: '<your locking bytecode, hex>' });
}
console.log(JSON.stringify(values, null, 2));
process.exit(0);
