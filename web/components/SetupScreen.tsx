'use client';
import { useMemo, useState } from 'react';
import { DEFAULT_RULES, priceAtRatio, validateParams } from '@backstop/contracts';
import type { LoanView, ProtectionChoices } from '../lib/actions';
import { bch, blocksAsTime, parseBch, percent, usd, usdOf } from '../lib/format';
import { HealthBar, HealthGauge } from './Health';
import { PriceScale } from './PriceScale';
import { Icon, Tween } from './ui';

const FEE_RESERVE_SATS = 3_000n; // what the setup transaction itself needs, roughly
const COOLDOWNS = [1n, 6n, 24n];

export function SetupScreen({ loan, priceCents, walletBchSats, onProtect, defaultCooldownBlocks = DEFAULT_RULES.cooldownBlocks }: {
  loan: LoanView;
  priceCents: bigint;
  walletBchSats: bigint;
  onProtect: (choices: ProtectionChoices) => Promise<void>;
  /** The local preview starts at one block, so a rescue can follow the setup straight away. */
  defaultCooldownBlocks?: bigint;
}) {
  const available = walletBchSats > FEE_RESERVE_SATS ? walletBchSats - FEE_RESERVE_SATS : 0n;
  const suggested = (() => {
    const half = loan.collateralSats / 2n;
    const value = half < available ? half : available;
    // Round down to a tidy amount: 0.01 BCH, or finer for small loans so it never shows 0.
    const step = value >= 1_000_000n ? 1_000_000n : value >= 100_000n ? 100_000n : 10_000n;
    return (value / step) * step;
  })();

  const [reserveText, setReserveText] = useState(bch(suggested).replace(' BCH', ''));
  const [trigger, setTrigger] = useState<bigint>(DEFAULT_RULES.triggerRatioBps);
  const [target, setTarget] = useState<bigint>(DEFAULT_RULES.targetRatioBps);
  const [maxTopUpText, setMaxTopUpText] = useState('');
  const [cooldown, setCooldown] = useState<bigint>(defaultCooldownBlocks);
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

  const sliderMax = available > 0n ? Number(available) : 0;
  // Tidy steps: about a hundredth of the balance's order of magnitude (0.001 BCH for a 1 BCH wallet).
  const sliderStep = sliderMax > 0 ? Math.max(1_000, 10 ** (Math.floor(Math.log10(sliderMax)) - 2)) : 1_000;
  const setReserve = (sats: bigint) => setReserveText(bch((sats / BigInt(sliderStep)) * BigInt(sliderStep)).replace(' BCH', ''));
  const presets: Array<[string, bigint]> = [['25%', available / 4n], ['Half', available / 2n], ['Max', available]];

  return (
    <div className="screen">
      <div className="card loan-card">
        <div className="loan-head">
          <div>
            <span className="eyebrow"><Icon name="shield" size={14} /> ParyonUSD loan</span>
            <h2>Your loan</h2>
            <p className="muted">Liquidated if BCH falls below <strong className="text-danger">{usd(loan.liquidationPriceCents)}</strong>. BCH is {usd(priceCents)} now.</p>
          </div>
          <HealthGauge ratioBps={loan.ratioBps} triggerBps={trigger} targetBps={target} size={220} />
        </div>
        <div className="stats">
          <div className="stat"><Icon name="coins" className="stat-icon" /><div className="label">Collateral</div><div className="value"><Tween value={loan.collateralSats} format={(v) => bch(v)} /></div><div className="sub">{usdOf(loan.collateralSats, priceCents)}</div></div>
          <div className="stat"><Icon name="wallet" className="stat-icon" /><div className="label">Borrowed</div><div className="value">{usd(loan.debtCents)}</div><div className="sub">ParyonUSD</div></div>
          <div className="stat"><Icon name="chart" className="stat-icon" /><div className="label">Health</div><div className="value"><Tween value={loan.ratioBps} format={percent} /></div><div className="sub">collateral ÷ borrowed</div></div>
          <div className="stat"><Icon name="alert" className="stat-icon danger" /><div className="label">Liquidated if BCH falls below</div><div className="value">{usd(loan.liquidationPriceCents)}</div><div className="sub">now {usd(priceCents)}</div></div>
        </div>
        <HealthBar ratioBps={loan.ratioBps} triggerBps={trigger} targetBps={target} />
      </div>

      <div className="card protect-card">
        <div className="card-head">
          <span className="badge-icon"><Icon name="shield" /></span>
          <div>
            <h2>Protect it</h2>
            <p className="muted">Pick a reserve and the rules. You can change your mind any time by withdrawing.</p>
          </div>
        </div>

        <div className="field">
          <label htmlFor="reserve">Reserve</label>
          <div className="amount">
            <input id="reserve" inputMode="decimal" value={reserveText} onChange={(e) => setReserveText(e.target.value)} aria-describedby="reserve-hint" />
            <span className="amount-unit">BCH</span>
          </div>
          {sliderMax > 0 && (
            <input type="range" className="slider" aria-label="Reserve amount" min={0} max={sliderMax} step={sliderStep}
              value={Math.min(sliderMax, Number(reserveSats ?? 0n))}
              style={{ ['--fill' as string]: `${sliderMax ? Math.min(100, (Number(reserveSats ?? 0n) / sliderMax) * 100) : 0}%` }}
              onChange={(e) => setReserve(BigInt(e.target.value))} />
          )}
          <div className="presets">
            {presets.map(([label, sats]) => (
              <button key={label} type="button" className={`chip ${reserveSats === sats ? 'active' : ''}`} disabled={sats <= 0n} onClick={() => setReserve(sats)}>{label}</button>
            ))}
          </div>
          <div className="hint" id="reserve-hint">
            BCH kept ready for rescues{reserveSats ? `, worth ${usdOf(reserveSats, priceCents)} today` : ''}. You have {bch(available)} available.
          </div>
        </div>

        <PriceScale priceCents={priceCents} liquidationCents={loan.liquidationPriceCents} protectedToCents={safeDownTo} rescueCents={triggerPrice} />

        <div className="row">
          <div className="field">
            <span className="label-text" id="trigger-label">Rescue when health falls below</span>
            <div className="segmented" role="group" aria-labelledby="trigger-label">
              {[12_000n, 12_500n, 13_000n, 14_000n].map((v) => (
                <button key={v.toString()} type="button" aria-pressed={trigger === v} className={trigger === v ? 'active' : ''} onClick={() => setTrigger(v)}>{percent(v)}</button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="label-text" id="target-label">and bring it back up to</span>
            <div className="segmented" role="group" aria-labelledby="target-label">
              {[14_000n, 15_000n, 17_500n, 20_000n].map((v) => (
                <button key={v.toString()} type="button" aria-pressed={target === v} className={target === v ? 'active' : ''} onClick={() => setTarget(v)}>{percent(v)}</button>
              ))}
            </div>
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

        <ul className="summary">
          <li><Icon name="bolt" /><span>If BCH falls below <strong>{usd(triggerPrice)}</strong> (your loan at {percent(trigger)}), up to <strong>{maxTopUpSats ? bch(maxTopUpSats) : '…'}</strong> from your reserve moves into your loan, bringing it back to at most {percent(target)}.</span></li>
          <li><Icon name="coins" /><span>Each rescue pays at most {bch(maxOverheadSats)} ({usdOf(maxOverheadSats, priceCents)}) in network fee and reward to whoever sends it, taken from your reserve. Rescues are at least {blocksAsTime(cooldown)} apart.</span></li>
          <li><Icon name="chart" /><span>With this reserve your loan can absorb a fall to about <strong>{usd(safeDownTo)}</strong> per BCH before liquidation, instead of {usd(loan.liquidationPriceCents)}.</span></li>
          <li><Icon name="lock" /><span>Your loan key and reserve move into your Backstop vault. Only your wallet can take them out, and no one else can move your BCH anywhere except into your own loan.</span></li>
        </ul>
        {alreadyBelow && <p className="banner">Your loan is already below {percent(trigger)}. A rescue can happen as soon as the setup is confirmed.</p>}
        {problem && reserveText !== '' && <p className="banner error" role="alert">{problem}</p>}
        {error && <p className="banner error" role="alert">{error}</p>}
        <div className="actions">
          <button className="primary big" onClick={submit} disabled={busy || problem !== undefined}>
            {busy ? <><span className="spinner" /> Approve in your wallet…</> : <><Icon name="shield" size={18} /> Protect my loan</>}
          </button>
          <span className="muted small">One signature. You can withdraw everything at any time.</span>
        </div>
      </div>
    </div>
  );
}
