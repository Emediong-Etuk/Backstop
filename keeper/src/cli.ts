// Backstop keeper CLI.
//
//   npm run keeper -- --dry-run            check every vault once and print what it would send
//   npm run keeper -- --watch              keep checking and broadcast rescues
//
// Options:
//   --deployment <file>   Paryon deployment (default: deployments/chipnet.json)
//   --vaults <file>       vault setup transaction IDs (default: keeper/vaults.json)
//   --dry-run             never broadcast; print the rescue transaction instead
//   --watch               repeat every --interval seconds (default 60)
//   --fee-rate <n>        miner fee in sat/byte (default 1)
//   --reward-sats <n>     keeper reward to ask for, capped by each vault (default 2000)
//   --server <host>       Electrum server (default: CashScript's server for the network)
//
// Environment (optional, see .env.example):
//   KEEPER_REWARD_ADDRESS  where rewards go. Without it the keeper works for free.
//   The keeper needs no private key and no funds.
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { ElectrumNetworkProvider, Network } from 'cashscript';
import { binToHex, cashAddressToLockingBytecode } from '@bitauth/libauth';
import { readJson, type Deployment, type VaultList } from './config.js';
import { scanOnce } from './keeper.js';

const root = resolve(import.meta.dirname, '../..');
// Optional settings from the repository's .env file (never committed; see .env.example).
if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
const { values } = parseArgs({
  options: {
    deployment: { type: 'string', default: resolve(root, 'deployments/chipnet.json') },
    vaults: { type: 'string', default: resolve(root, 'keeper/vaults.json') },
    'dry-run': { type: 'boolean', default: false },
    watch: { type: 'boolean', default: false },
    interval: { type: 'string', default: '60' },
    'fee-rate': { type: 'string', default: '1' },
    'reward-sats': { type: 'string', default: '2000' },
    server: { type: 'string' },
  },
});

const deployment = readJson<Deployment>(values.deployment);
const { vaults } = readJson<VaultList>(values.vaults);
if (deployment.network !== 'chipnet' && deployment.network !== 'mainnet') {
  throw new Error(`The CLI runs on chipnet or mainnet; "${deployment.network}" is for tests`);
}
const network = deployment.network === 'chipnet' ? Network.CHIPNET : Network.MAINNET;
const provider = new ElectrumNetworkProvider(network, values.server ? { hostname: values.server } : {});
try {
  await provider.getBlockHeight();
} catch (error) {
  console.error(`Cannot reach a ${network} Electrum server${values.server ? ` at ${values.server}` : ''}: ${(error as Error).message}`);
  console.error('Try another server with --server <host>, e.g. --server chipnet.imaginary.cash');
  process.exit(1);
}

let keeperLockingBytecode: string | undefined;
const rewardAddress = process.env.KEEPER_REWARD_ADDRESS;
if (rewardAddress) {
  const decoded = cashAddressToLockingBytecode(rewardAddress);
  if (typeof decoded === 'string') throw new Error(`KEEPER_REWARD_ADDRESS: ${decoded}`);
  keeperLockingBytecode = binToHex(decoded.bytecode);
}

console.log(`Backstop keeper on ${network}${deployment.label ? ` (${deployment.label})` : ''}: ${vaults.length} vault(s)${values['dry-run'] ? ', DRY RUN' : ''}`);

async function pass() {
  await scanOnce({
    provider,
    deployment,
    setupTxids: vaults.map((v) => v.setupTxid),
    dryRun: values['dry-run'],
    feeRate: Number(values['fee-rate']),
    keeperRewardSats: BigInt(values['reward-sats']),
    keeperLockingBytecode,
  });
}

await pass();
if (values.watch) {
  const intervalMs = Number(values.interval) * 1000;
  for (;;) {
    await new Promise((r) => setTimeout(r, intervalMs));
    await pass().catch((error) => console.error('pass failed:', (error as Error).message));
  }
} else {
  process.exit(0);
}
