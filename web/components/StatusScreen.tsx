'use client';
import { useEffect, useRef, useState } from 'react';
import type { VaultView } from '../lib/actions';
import { bch, blocksAsTime, percent, usd, usdOf } from '../lib/format';
import { HealthBar, HealthGauge } from './Health';
import { VaultVisual } from './VaultVisual';
import { Confetti, Icon, Tween } from './ui';

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
  const reserveLeft = view.reserveSats > params.maxOverheadSats + 2_000n;
  const lastSetup = [...view.events].reverse().find((e) => e.kind === 'setup');
  const startReserveSats = lastSetup?.kind === 'setup' ? lastSetup.reserveSats : view.reserveSats;

  // Celebrate a rescue that lands while the page is open (not the ones already in the history).
  const seenRescues = useRef(rescues.length);
  const [burst, setBurst] = useState(0);
  const [flowing, setFlowing] = useState(false);
  useEffect(() => {
    if (rescues.length > seenRescues.current) {
      setBurst((b) => b + 1);
      setFlowing(true);
      const timer = setTimeout(() => setFlowing(false), 3200);
      seenRescues.current = rescues.length;
      return () => clearTimeout(timer);
    }
    seenRescues.current = rescues.length;
  }, [rescues.length]);

  const state = belowTrigger ? (reserveLeft ? 'warn' : 'danger') : 'safe';
  const headline = belowTrigger
    ? reserveLeft ? 'Your loan is below your rescue level' : 'Your reserve is used up'
    : 'Your loan is protected';
  const subline = belowTrigger
    ? reserveLeft
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

  const link = (txid: string, text: string) => explorerTx ? <a href={explorerTx(txid)} target="_blank" rel="noreferrer">{text} <Icon name="arrow" size={12} /></a> : <span className="muted">{text}</span>;
  const when = (height: number) => (height > 0 ? `block ${height.toLocaleString('en-US')}` : 'waiting for confirmation');

  return (
    <div className="screen">
      <Confetti burst={burst} />
      <div className={`card status-hero state-${state} ${flowing ? 'just-rescued' : ''}`}>
        <div className="status-main">
          <div className={`status-badge state-${state}`} aria-hidden="true">
            <span className="ring" /><span className="ring two" />
            <Icon name={state === 'safe' ? 'shield' : state === 'warn' ? 'bolt' : 'alert'} size={30} />
          </div>
          <div>
            <h2>{headline}</h2>
            <p className="muted">{subline}</p>
            {flowing && <p className="rescue-flash" role="status"><Icon name="sparkle" size={16} /> A rescue just landed in your loan.</p>}
          </div>
        </div>
        <div className="status-gauge">
          <HealthGauge ratioBps={loan.ratioBps} triggerBps={params.triggerRatioBps} targetBps={params.targetRatioBps} size={240} />
        </div>
        <HealthBar ratioBps={loan.ratioBps} triggerBps={params.triggerRatioBps} targetBps={params.targetRatioBps} />
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>Your vault</h3>
          <VaultVisual reserveSats={view.reserveSats} startReserveSats={startReserveSats} ratioBps={loan.ratioBps}
            triggerBps={params.triggerRatioBps} targetBps={params.targetRatioBps} flowing={flowing} />
          <p className="muted small">
            Each rescue adds up to {bch(params.maxTopUpSats)}, brings your loan back to at most {percent(params.targetRatioBps)},
            costs at most {bch(params.maxOverheadSats)} in fees, and rescues are at least {blocksAsTime(params.cooldownBlocks)} apart.
          </p>
        </div>

        <div className="stats stacked">
          <div className="stat"><Icon name="coins" className="stat-icon" /><div className="label">Your reserve</div><div className="value"><Tween value={view.reserveSats} format={(v) => bch(v, 4)} /></div><div className="sub">{usdOf(view.reserveSats, priceCents)}</div></div>
          <div className="stat"><Icon name="chart" className="stat-icon" /><div className="label">Loan health</div><div className="value"><Tween value={loan.ratioBps} format={percent} /></div><div className="sub">{bch(loan.collateralSats, 4)} for {usd(loan.debtCents)}</div></div>
          <div className="stat"><Icon name="bolt" className="stat-icon warn" /><div className="label">Rescue if BCH falls below</div><div className="value"><Tween value={loan.triggerPriceCents} format={usd} /></div><div className="sub">now {usd(priceCents)}</div></div>
          <div className="stat"><Icon name="alert" className="stat-icon danger" /><div className="label">Liquidation below</div><div className="value"><Tween value={loan.liquidationPriceCents} format={usd} /></div><div className="sub">at today&rsquo;s collateral</div></div>
        </div>
      </div>

      <div className="card">
        <h3>History</h3>
        <ol className="timeline">
          {[...view.events].reverse().map((event) => (
            <li key={event.txid} className={`event-${event.kind}`}>
              <span className="timeline-dot"><Icon name={event.kind === 'setup' ? 'shield' : event.kind === 'rescue' ? 'bolt' : 'exit'} size={14} /></span>
              <div className="timeline-body">
                {event.kind === 'setup' && <span>Protection set up with a {bch(event.reserveSats)} reserve</span>}
                {event.kind === 'rescue' && <span><strong>Rescued:</strong> {bch(event.topUpSats)} ({usdOf(event.topUpSats, priceCents)}) added to your loan, {bch(event.overheadSats)} in fees</span>}
                {event.kind === 'withdraw' && <span>Withdrawn</span>}
                <span className="small timeline-when">{link(event.txid, when(event.height))}</span>
              </div>
            </li>
          ))}
        </ol>
        {rescues.length === 0 && <p className="muted small">No rescues so far.</p>}
      </div>

      <div className="card withdraw-card">
        {!confirming ? (
          <div className="actions">
            <button className="secondary" onClick={() => setConfirming(true)}><Icon name="exit" size={18} /> Withdraw everything</button>
            <span className="muted small">Your loan key and reserve come back to your wallet.</span>
          </div>
        ) : (
          <div className="confirm">
            <p>Your loan key and <strong>{bch(view.reserveSats, 4)}</strong> go back to your wallet. Your loan will no longer be protected.</p>
            <div className="actions">
              <button className="danger" onClick={withdraw} disabled={busy}>{busy ? <><span className="spinner" /> Approve in your wallet…</> : 'Withdraw everything'}</button>
              <button className="link" onClick={() => setConfirming(false)} disabled={busy}>Keep my protection</button>
            </div>
          </div>
        )}
        {error && <p className="banner error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
