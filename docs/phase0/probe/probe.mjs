// Phase 0 research probe (not Backstop code). Runs Paryon's real compiled add-collateral
// contracts on CashScript's MockNetworkProvider with the loan key in a P2SH32 holder, then
// tries the attacks a keeper could attempt if nothing restricted the key. Run: npm install && npm run probe
import { Contract, MockNetworkProvider, TransactionBuilder, randomUtxo } from 'cashscript';
import { paryonArtifacts as A } from '@paryonusd/contracts';
import fs from 'fs';
const holderArt = JSON.parse(fs.readFileSync(new URL('./Holder.json', import.meta.url)));
const provider = new MockNetworkProvider();
const opt = { provider, addressType: 'p2sh32' };
console.log(Object.keys(A));
const oraclePk = '02d09db08af1ff4e8453919cc866a4be427d7bfe18f2c05e5444c196fcf6fd2818';
const price = new Contract(A.artifactPriceContractGuarded ?? A.artifactPriceContract, [oraclePk, '11'.repeat(32)], opt);
const loan = new Contract(A.artifactLoan, [], opt);
const sidecar = new Contract(A.artifactLoanSidecar, [], opt);
const manage = new Contract(A.loanContractFunctions.artifactManage ?? Object.values(A.loanContractFunctions).find(a=>a.contractName==="manageLoan"), [], opt);
const keyHolder = new Contract(holderArt, [], opt);
const le = (n, len) => { const b = Buffer.alloc(len); let x = BigInt(n); for (let i=0;i<len;i++){ b[i]=Number(x & 0xffn); x >>= 8n;} return b.toString('hex'); };
const PARYON = 'aa'.repeat(32), LOANKEY = 'bb'.repeat(32);
const priceCents = 30000; // $300.00
const priceCommit = '00' + le(1000,4) + le(priceCents,4);
const mgrCfg = '0000000000';
const loanCommit = '01' + le(200_00,6) + le(0,6) + '02' + le(5,4) + le(100,2) + le(100,2) + mgrCfg;
console.log('loan commitment bytes', loanCommit.length/2);
const txid = 'cc'.repeat(32);
const add = (c, utxo) => provider.addUtxo(c.address, utxo);
const uPrice = add(price, { txid: 'dd'.repeat(32), vout: 0, satoshis: 1000n, token: { category: PARYON, amount: 0n, nft: { capability: 'mutable', commitment: priceCommit } } });
const uLoan = add(loan, { txid, vout: 2, satoshis: 100_000_000n, token: { category: PARYON, amount: 0n, nft: { capability: 'mutable', commitment: loanCommit } } });
const uSide = add(sidecar, { txid, vout: 3, satoshis: 1000n, token: { category: LOANKEY, amount: 0n, nft: { capability: 'none', commitment: '01' } } });
const uManage = add(manage, { txid: 'ee'.repeat(32), vout: 0, satoshis: 1000n, token: { category: PARYON, amount: 0n, nft: { capability: 'none', commitment: '02' } } });
const uKey = add(keyHolder, { txid: 'ff'.repeat(32), vout: 0, satoshis: 1000n, token: { category: LOANKEY, amount: 0n, nft: { capability: 'minting', commitment: '' } } });
const uRes = add(keyHolder, { txid: 'ff'.repeat(32), vout: 1, satoshis: 50_000_000n });
const topUp = 20_000_000n, fee = 3000n, reward = 2000n;
const build = (extra) => {
  const tb = new TransactionBuilder({ provider })
  .addInput(uPrice, price.unlock.sharePrice())
  .addInput(uLoan, loan.unlock.interact())
  .addInput(uSide, sidecar.unlock.attach())
  .addInput(uManage, manage.unlock.manage(0n, mgrCfg))
  .addInput(uKey, keyHolder.unlock.go())
  .addInput(uRes, keyHolder.unlock.go())
  .addOutput({ to: price.tokenAddress, amount: 1000n, token: uPrice.token })
  .addOutput({ to: loan.tokenAddress, amount: uLoan.satoshis + topUp, token: uLoan.token })
  .addOutput({ to: sidecar.tokenAddress, amount: 1000n, token: uSide.token })
  .addOutput({ to: manage.tokenAddress, amount: 1000n, token: uManage.token })
  .addOutput({ to: keyHolder.tokenAddress, amount: 1000n, token: uKey.token })
  .addOutput({ to: keyHolder.address, amount: uRes.satoshis - topUp - fee - reward })
  .addOutput({ to: keyHolder.address, amount: reward });
  extra?.(tb);
  return tb;
};
try { const tx = await build(tb => tb.addOpReturnOutput(['BKSP', '0x01'])).send(); console.log('OK composed tx (6 in / 8 out incl OP_RETURN)', tx.txid, 'size', tx.hex.length/2); } catch (e) { console.log('FAIL', e.message.slice(0, 1500)); }
const tryIt = async (label, f) => { try { await f(); console.log('ACCEPTED:', label); } catch (e) { console.log('REJECTED:', label, '-', (e.message.match(/(Failing statement|reason|Error)[^\n]*\n?[^\n]*/)||[e.message.slice(0,200)])[0].replace(/\s+/g,' ').slice(0,220)); } };
// fresh UTXOs each attempt
let n = 0;
const fresh = () => { n++; const t = (h) => (h + n.toString(16).padStart(2,'0')).padEnd(64,'0');
  return {
  p: add(price, { ...uPrice, txid: t('d1') }), l: add(loan, { ...uLoan, txid: t('c1') }), s: add(sidecar, { ...uSide, txid: t('c1') }),
  m: add(manage, { ...uManage, txid: t('e1') }), k: add(keyHolder, { ...uKey, txid: t('f1') }), r: add(keyHolder, { ...uRes, txid: t('f1') }) }; };
const tb5 = (u, outs) => { const tb = new TransactionBuilder({ provider })
  .addInput(u.p, price.unlock.sharePrice()).addInput(u.l, loan.unlock.interact()).addInput(u.s, sidecar.unlock.attach())
  .addInput(u.m, manage.unlock.manage(0n, outs.cfg ?? mgrCfg)).addInput(u.k, keyHolder.unlock.go());
  if (outs.res) tb.addInput(u.r, keyHolder.unlock.go());
  tb.addOutput({ to: price.tokenAddress, amount: 1000n, token: u.p.token })
    .addOutput({ to: loan.tokenAddress, amount: outs.loanValue, token: outs.loanToken ?? u.l.token })
    .addOutput({ to: sidecar.tokenAddress, amount: 1000n, token: u.s.token })
    .addOutput({ to: manage.tokenAddress, amount: 1000n, token: u.m.token })
    .addOutput({ to: keyHolder.tokenAddress, amount: outs.keyValue ?? u.k.satoshis, token: u.k.token });
  for (const o of outs.extra ?? []) tb.addOutput(o);
  return tb; };
const attacker = keyHolder.address; // stand-in address
await tryIt('withdraw 0.1 BCH collateral (no Backstop)', () => { const u = fresh(); return tb5(u, { loanValue: 90_000_000n, extra: [{ to: attacker, amount: 9_990_000n }] }).send(); });
await tryIt('mint a second minting loan key to attacker (no Backstop)', () => { const u = fresh(); return tb5(u, { loanValue: u.l.satoshis, res: true, extra: [{ to: keyHolder.tokenAddress, amount: 1000n, token: { category: LOANKEY, amount: 0n, nft: { capability: 'minting', commitment: '' } } }, { to: attacker, amount: 49_990_000n }] }).send(); });
await tryIt('change interest manager config (no Backstop)', () => { const u = fresh(); const cfg='01ffff0000'; return tb5(u, { cfg, loanValue: u.l.satoshis, loanToken: { ...u.l.token, nft: { ...u.l.token.nft, commitment: loanCommit.slice(0,-10)+cfg } }, res: true, extra: [{ to: attacker, amount: 49_990_000n }] }).send(); });
// single-UTXO vault: key UTXO also holds reserve, returned with less value
const bigKey = add(keyHolder, { txid: 'ab'.repeat(32), vout: 0, satoshis: 50_000_000n, token: uKey.token });
await tryIt('single-UTXO vault: key returned with reserve minus top-up', () => { const u = fresh(); u.k = bigKey; return tb5(u, { loanValue: u.l.satoshis + topUp, keyValue: 50_000_000n - topUp - 5000n }).send(); });
