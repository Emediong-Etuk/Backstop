'use client';
import { useState } from 'react';
import type { VaultView } from '../lib/actions';
import { bch, blocksAsTime, percent, usd, usdOf } from '../lib/format';
import { HealthBar } from './Health';

export function StatusScreen({ view, priceCents, explorerTx, onWithdraw }: {
  view: VaultView;
  priceCents: bigint;
  explorerTx?: (txid: string) => string;
  onWithdraw: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const { params } = view.vault;
  const loan = view.loan!;
  const rescues = view.events.filter((e) => e.kind === 'rescue');
  const belowTrigger = loan.ratioBps < params.triggerRatioBps;

  const headline = belowTrigger
    ? view.reserveSats > params.maxOverheadSats + 2_000n ? 'Your loan is below your rescue level' : 'Your reserve is used up'
    : 'Your loan is protected';
  const subline = belowTrigger
    ? view.reserveSats > params.maxOverheadSats + 2_000n
      ? 'A rescue can be sent by anyone right now. Nothing for you to do.'
      : 'Add collateral to your loan yourself, or withdraw and set up a new reserve.'
    : `${rescues.length > 0 ? `Rescued ${rescues.length === 1 ? 'once' : `${rescues.length} times`} so far. ` : ''}If BCH falls below ${usd(loan.triggerPriceCents)}, part of your reserve moves into your loan.`;

  async function withdraw() {
    setBusy(true);
    setError(undefined);
    try {
      await onWithdraw();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const link = (txid: string, text: string) => explorerTx ? <a href={explorerTx(txid)} target="_blank" rel="noreferrer">{text}</a> : <span className="muted">{text}</span>;
  const when = (height: number) => (height > 0 ? `block ${height.toLocaleString('en-US')}` : 'waiting for confirmation');

  return (
    <>
      <div className="card">
        <h2>{headline}</h2>
        <p className="muted">{subline}</p>
        <HealthBar ratioBps={loan.ratioBps} triggerBps={params.triggerRatioBps} targetBps={params.targetRatioBps} />
        <div className="stats">
          <div className="stat"><div className="label">Your reserve</div><div className="value">{bch(view.reserveSats, 4)}</div><div className="sub">{usdOf(view.reserveSats, priceCents)}</div></div>
          <div className="stat"><div className="label">Loan health</div><div className="value">{percent(loan.ratioBps)}</div><div className="sub">{bch(loan.collateralSats, 4)} for {usd(loan.debtCents)}</div></div>
          <div className="stat"><div className="label">Rescue if BCH falls below</div><div className="value">{usd(loan.triggerPriceCents)}</div><div className="sub">now {usd(priceCents)}</div></div>
          <div className="stat"><div className="label">Liquidation below</div><div className="value">{usd(loan.liquidationPriceCents)}</div><div className="sub">at today&rsquo;s collateral</div></div>
        </div>
        <p className="muted small" style={{ marginTop: 12 }}>
          Each rescue adds up to {bch(params.maxTopUpSats)}, brings your loan back to at most {percent(params.targetRatioBps)},
          costs at most {bch(params.maxOverheadSats)} in fees, and rescues are at least {blocksAsTime(params.cooldownBlocks)} apart.
        </p>
      </div>

      <div className="card">
        <h3>History</h3>
        <ul className="history">
          {[...view.events].reverse().map((event) => (
            <li key={event.txid}>
              {event.kind === 'setup' && <span>Protection set up with a {bch(event.reserveSats)} reserve</span>}
              {event.kind === 'rescue' && <span><strong>Rescued:</strong> {bch(event.topUpSats)} ({usdOf(event.topUpSats, priceCents)}) added to your loan, {bch(event.overheadSats)} in fees</span>}
              {event.kind === 'withdraw' && <span>Withdrawn</span>}
              <span className="small">{link(event.txid, when(event.height))}</span>
            </li>
          ))}
        </ul>
        {rescues.length === 0 && <p className="muted small" style={{ marginTop: 8 }}>No rescues so far.</p>}
      </div>

      <div className="card">
        {!confirming ? (
          <div className="actions">
            <button className="secondary" onClick={() => setConfirming(true)}>Withdraw everything</button>
            <span className="muted small">Your loan key and reserve come back to your wallet.</span>
          </div>
        ) : (
          <>
            <p>Your loan key and {bch(view.reserveSats, 4)} go back to your wallet. Your loan will no longer be protected.</p>
            <div className="actions">
              <button className="danger" onClick={withdraw} disabled={busy}>{busy ? 'Approve in your wallet…' : 'Withdraw everything'}</button>
              <button className="link" onClick={() => setConfirming(false)} disabled={busy}>Keep my protection</button>
            </div>
          </>
        )}
        {error && <p className="banner error" role="alert" style={{ marginTop: 12 }}>{error}</p>}
      </div>
    </>
  );
}
