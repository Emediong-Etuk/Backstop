'use client';
import { percent } from '../lib/format';
import { useTweened } from './ui';

type Zone = 'danger' | 'warn' | 'safe';

export function zoneOf(ratioBps: bigint, triggerBps: bigint): Zone {
  if (ratioBps < 11_000n) return 'danger';
  if (ratioBps < triggerBps) return 'warn';
  return 'safe';
}

/**
 * Loan health as a dial: the needle sits where the loan is now, between liquidation (110%),
 * the rescue level, and the level a rescue lifts the loan back to. It glides when the price moves.
 */
export function HealthGauge({ ratioBps, triggerBps, targetBps, size = 260 }: { ratioBps: bigint; triggerBps: bigint; targetBps?: bigint; size?: number }) {
  const min = 10_000;
  const max = Number(targetBps ?? triggerBps) + 3_000;
  const shown = useTweened(Number(ratioBps));
  const fraction = (bps: number) => Math.min(1, Math.max(0, (bps - min) / (max - min)));
  const zone = zoneOf(BigInt(Math.round(shown)), triggerBps);

  // A half circle from 180° (left) to 0° (right).
  const r = 100;
  const cx = 120;
  const cy = 120;
  const point = (f: number, radius = r) => {
    const angle = Math.PI * (1 - f);
    return [cx + radius * Math.cos(angle), cy - radius * Math.sin(angle)] as const;
  };
  const arc = (from: number, to: number) => {
    const [x1, y1] = point(from);
    const [x2, y2] = point(to);
    return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
  };
  const liq = fraction(11_000);
  const trig = fraction(Number(triggerBps));
  const needle = fraction(shown);
  const [nx, ny] = point(needle, r - 26);
  const tick = (f: number) => { const [x1, y1] = point(f, r - 14); const [x2, y2] = point(f, r + 14); return { x1, y1, x2, y2 }; };

  return (
    <div className={`gauge zone-${zone}`} role="img" aria-label={`Loan health ${percent(ratioBps)}. Liquidation at 110%, rescue below ${percent(triggerBps)}.`}>
      <svg viewBox="0 0 240 140" width={size} style={{ maxWidth: '100%' }}>
        <defs>
          <linearGradient id="gauge-safe" x1="0" x2="1"><stop offset="0" stopColor="var(--accent)" /><stop offset="1" stopColor="var(--accent-2)" /></linearGradient>
          <filter id="gauge-glow"><feGaussianBlur stdDeviation="3" /></filter>
        </defs>
        <path d={arc(0, 1)} className="gauge-track" />
        <path d={arc(0, liq)} className="gauge-zone danger" />
        <path d={arc(liq, trig)} className="gauge-zone warn" />
        <path d={arc(trig, 1)} className="gauge-zone safe" />
        <path d={arc(0, Math.max(0.001, needle))} className="gauge-fill" filter="url(#gauge-glow)" />
        <line {...tick(liq)} className="gauge-tick danger" />
        <line {...tick(trig)} className="gauge-tick" />
        {targetBps !== undefined && <line {...tick(fraction(Number(targetBps)))} className="gauge-tick target" />}
        <line x1={cx} y1={cy} x2={nx} y2={ny} className="gauge-needle" />
        <circle cx={cx} cy={cy} r="7" className="gauge-hub" />
      </svg>
      <div className="gauge-readout">
        <span className="gauge-value num">{percent(BigInt(Math.round(shown)))}</span>
        <span className="gauge-label">{zone === 'safe' ? 'healthy' : zone === 'warn' ? 'below rescue level' : 'liquidation zone'}</span>
      </div>
    </div>
  );
}

/**
 * Loan health on one line: where liquidation happens (110%), where a rescue starts,
 * where a rescue lifts the loan to, and where the loan is now.
 */
export function HealthBar({ ratioBps, triggerBps, targetBps }: { ratioBps: bigint; triggerBps: bigint; targetBps?: bigint }) {
  const min = 10_000;
  const max = Number(targetBps ?? triggerBps) + 3_000;
  const shown = useTweened(Number(ratioBps));
  const pct = (bps: number) => Math.min(100, Math.max(0, ((bps - min) / (max - min)) * 100));
  const pos = (bps: bigint | number) => `${pct(Number(bps))}%`;
  const zone = zoneOf(BigInt(Math.round(shown)), triggerBps);
  return (
    <div className="health" role="img" aria-label={`Loan health ${percent(ratioBps)}. Liquidation at 110%, rescue below ${percent(triggerBps)}.`}>
      <div className="health-track" style={{
        ['--liq' as string]: pos(11_000), ['--trig' as string]: pos(triggerBps),
      }}>
        <div className={`health-fill zone-${zone}`} style={{ width: `${pct(shown)}%` }} />
        <div className="health-mark danger" style={{ left: pos(11_000) }} />
        <div className="health-mark" style={{ left: pos(triggerBps) }} />
        {targetBps !== undefined && <div className="health-mark target" style={{ left: pos(targetBps) }} />}
        <div className={`health-dot zone-${zone}`} style={{ left: `${pct(shown)}%` }}><span /></div>
      </div>
      <div className="health-labels">
        <span style={{ left: pos(11_000) }}>Liquidation<br />110%</span>
        <span style={{ left: pos(triggerBps) }}>Rescue<br />{percent(triggerBps)}</span>
        {targetBps !== undefined && <span style={{ left: pos(targetBps) }}>Back to<br />{percent(targetBps)}</span>}
      </div>
    </div>
  );
}
