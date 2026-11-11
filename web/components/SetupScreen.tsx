'use client';
import { useMemo, useState } from 'react';
import { DEFAULT_RULES, priceAtRatio, validateParams } from '@backstop/contracts';
import type { LoanView, ProtectionChoices } from '../lib/actions';
import { bch, blocksAsTime, parseBch, percent, usd, usdOf } from '../lib/format';
import { HealthBar } from './Health';

const FEE_RESERVE_SATS = 3_000n; // what the setup transaction itself needs, roughly
const COOLDOWNS = [1n, 6n, 24n];

export function SetupScreen({ loan, priceCents, walletBchSats, onProtect }: {
  loan: LoanView;
  priceCents: bigint;
  walletBchSats: bigint;
  onProtect: (choices: ProtectionChoices) => Promise<void>;
}) {
  const available = walletBchSats > FEE_RESERVE_SATS ? walletBchSats - FEE_RESERVE_SATS : 0n;
  const suggested = (() => {
    const half = loan.collateralSats / 2n;
    const value = half < available ? half : available;
    return (value / 1_000_000n) * 1_000_000n; // round down to 0.01 BCH
  })();

  const [reserveText, setReserveText] = useState(bch(suggested).replace(' BCH', ''));
  const [trigger, setTrigger] = useState<bigint>(DEFAULT_RULES.triggerRatioBps);
  const [target, setTarget] = useState<bigint>(DEFAULT_RULES.targetRatioBps);
  const [maxTopUpText, setMaxTopUpText] = useState('');
  const [cooldown, setCooldown] = useState<bigint>(DEFAULT_RULES.cooldownBlocks);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const reserveSats = parseBch(reserveText);
  const maxTopUpSats = maxTopUpText.trim() === '' ? (reserveSats ?? 0n) / 2n : parseBch(maxTopUpText);
  const maxOverheadSats = DEFAULT_RULES.maxOverheadSats;

  const problem = useMemo(() => {
    if (reserveSats === undefined || reserveSats <= 0n) return 'Enter how much BCH to keep in reserve.';
    if (reserveSats > available) return `Your wallet has ${bch(available)} available after network fees.`;
    if (reserveSats < 10_000n) return 'The reserve should be at least 0.0001 BCH.';
    if (maxTopUpSats === undefined || maxTopUpSats <= 0n) return 'Enter the most BCH a single rescue may add.';
    if (target <= trigger) return 'The level a rescue lifts your loan to must be above the level that starts it.';
    try {
      validateParams({
        ownerPkh: '00'.repeat(20), loanKeyCategory: loan.loanKeyCategory, paryonTokenId: '00'.repeat(32), manageLockingBytecode: '00',
        triggerRatioBps: trigger, targetRatioBps: target, maxTopUpSats, maxOverheadSats, cooldownBlocks: cooldown,
      });
    } catch (e) {
      return (e as Error).message;
    }
    return undefined;
  }, [reserveSats, available, maxTopUpSats, trigger, target, cooldown, loan.loanKeyCategory, maxOverheadSats]);

  const triggerPrice = priceAtRatio(loan.collateralSats, loan.debtCents, trigger);
  const safeDownTo = reserveSats ? priceAtRatio(loan.collateralSats + reserveSats, loan.debtCents, 11_000n) : loan.liquidationPriceCents;
  const alreadyBelow = loan.ratioBps < trigger;

  async function submit() {
    if (problem || reserveSats === undefined || maxTopUpSats === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      await onProtect({ reserveSats, triggerRatioBps: trigger, targetRatioBps: target, maxTopUpSats, maxOverheadSats, cooldownBlocks: cooldown });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card">
        <h2>Your loan</h2>
        <div className="stats">
          <div className="stat"><div className="label">Collateral</div><div className="value">{bch(loan.collateralSats)}</div><div className="sub">{usdOf(loan.collateralSats, priceCents)}</div></div>
          <div className="stat"><div className="label">Borrowed</div><div className="value">{usd(loan.debtCents)}</div><div className="sub">ParyonUSD</div></div>
          <div className="stat"><div className="label">Health</div><div className="value">{percent(loan.ratioBps)}</div><div className="sub">collateral ÷ borrowed</div></div>
          <div className="stat"><div className="label">Liquidated if BCH falls below</div><div className="value">{usd(loan.liquidationPriceCents)}</div><div className="sub">now {usd(priceCents)}</div></div>
        </div>
        <HealthBar ratioBps={loan.ratioBps} triggerBps={trigger} targetBps={target} />
      </div>

      <div className="card">
        <h2>Protect it</h2>
        <div className="field">
          <label htmlFor="reserve">Reserve</label>
          <input id="reserve" inputMode="decimal" value={reserveText} onChange={(e) => setReserveText(e.target.value)} aria-describedby="reserve-hint" />
          <div className="hint" id="reserve-hint">
            BCH kept ready for rescues{reserveSats ? `, worth ${usdOf(reserveSats, priceCents)} today` : ''}. You have {bch(available)} available.
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="trigger">Rescue when health falls below</label>
            <select id="trigger" value={trigger.toString()} onChange={(e) => setTrigger(BigInt(e.target.value))}>
              {[12_000n, 12_500n, 13_000n, 14_000n].map((v) => <option key={v.toString()} value={v.toString()}>{percent(v)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="target">and bring it back up to</label>
            <select id="target" value={target.toString()} onChange={(e) => setTarget(BigInt(e.target.value))}>
              {[14_000n, 15_000n, 17_500n, 20_000n].map((v) => <option key={v.toString()} value={v.toString()}>{percent(v)}</option>)}
            </select>
          </div>
        </div>
        <details>
          <summary>More settings</summary>
          <div className="row">
            <div className="field">
              <label htmlFor="max">Most BCH per rescue</label>
              <input id="max" inputMode="decimal" placeholder={reserveSats ? bch(reserveSats / 2n).replace(' BCH', '') : ''} value={maxTopUpText} onChange={(e) => setMaxTopUpText(e.target.value)} />
              <div className="hint">Default: half of your reserve.</div>
            </div>
            <div className="field">
              <label htmlFor="cooldown">Time between rescues</label>
              <select id="cooldown" value={cooldown.toString()} onChange={(e) => setCooldown(BigInt(e.target.value))}>
                {COOLDOWNS.map((v) => <option key={v.toString()} value={v.toString()}>{blocksAsTime(v)} ({v.toString()} block{v === 1n ? '' : 's'})</option>)}
              </select>
            </div>
          </div>
        </details>

        <div className="summary">
          <p><strong>What happens:</strong> if BCH falls below <strong>{usd(triggerPrice)}</strong> (your loan at {percent(trigger)}), up to <strong>{maxTopUpSats ? bch(maxTopUpSats) : '…'}</strong> from your reserve moves into your loan, bringing it back to at most {percent(target)}.</p>
          <p>Each rescue pays at most {bch(maxOverheadSats)} ({usdOf(maxOverheadSats, priceCents)}) in network fee and reward to whoever sends it, taken from your reserve. Rescues are at least {blocksAsTime(cooldown)} apart.</p>
          <p>With this reserve your loan can absorb a fall to about <strong>{usd(safeDownTo)}</strong> per BCH before liquidation, instead of {usd(loan.liquidationPriceCents)}.</p>
          <p>Your loan key and reserve move into your Backstop vault. Only your wallet can take them out, and no one else can move your BCH anywhere except into your own loan.</p>
        </div>
        {alreadyBelow && <p className="banner">Your loan is already below {percent(trigger)}. A rescue can happen as soon as the setup is confirmed.</p>}
        {problem && reserveText !== '' && <p className="banner error" role="alert">{problem}</p>}
        {error && <p className="banner error" role="alert">{error}</p>}
        <div className="actions">
          <button onClick={submit} disabled={busy || problem !== undefined}>{busy ? 'Approve in your wallet…' : 'Protect my loan'}</button>
          <span className="muted small">One signature. You can withdraw everything at any time.</span>
        </div>
      </div>
    </>
  );
}
