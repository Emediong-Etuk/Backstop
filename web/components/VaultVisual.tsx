'use client';
// The vault as two tanks: the reserve on the left, the loan on the right. Levels glide when
// they change; when a rescue lands, BCH visibly flows from the reserve into the loan.
import { bch, percent } from '../lib/format';
import { Icon, useTweened } from './ui';

export function VaultVisual({ reserveSats, startReserveSats, ratioBps, triggerBps, targetBps, flowing }: {
  reserveSats: bigint;
  startReserveSats: bigint;
  ratioBps: bigint;
  triggerBps: bigint;
  targetBps: bigint;
  flowing: boolean;
}) {
  const reserveFraction = startReserveSats > 0n ? Math.min(1, Number(reserveSats) / Number(startReserveSats)) : 0;
  const min = 10_000;
  const max = Number(targetBps) + 3_000;
  const level = (bps: number) => Math.min(1, Math.max(0.04, (bps - min) / (max - min)));
  const reserveLevel = useTweened(reserveFraction, 1200);
  const loanLevel = useTweened(level(Number(ratioBps)), 1200);
  const zone = ratioBps < 11_000n ? 'danger' : ratioBps < triggerBps ? 'warn' : 'safe';

  return (
    <div className={`vault ${flowing ? 'is-flowing' : ''}`} role="img"
      aria-label={`Reserve ${bch(reserveSats, 4)}, ${Math.round(reserveFraction * 100)}% of what you set aside. Loan health ${percent(ratioBps)}.`}>
      <div className="tank-col">
        <div className="tank">
          <div className="liquid" style={{ height: `${reserveLevel * 100}%` }}><span className="wave" /><span className="wave two" /></div>
        </div>
        <div className="tank-caption"><Icon name="coins" size={16} /> Reserve</div>
        <div className="tank-value num">{bch(reserveSats, 4)}</div>
      </div>

      <div className="pipe" aria-hidden="true">
        <div className="pipe-line" />
        {[0, 1, 2, 3, 4].map((i) => <span key={i} className="pipe-drop" style={{ animationDelay: `${i * 140}ms` }} />)}
        <div className="pipe-label"><Icon name="bolt" size={14} /> rescue</div>
      </div>

      <div className="tank-col">
        <div className={`tank loan zone-${zone}`}>
          <div className="tank-line danger" style={{ bottom: `${level(11_000) * 100}%` }}><span>110%</span></div>
          <div className="tank-line" style={{ bottom: `${level(Number(triggerBps)) * 100}%` }}><span>{percent(triggerBps)}</span></div>
          <div className="liquid" style={{ height: `${loanLevel * 100}%` }}><span className="wave" /><span className="wave two" /></div>
        </div>
        <div className="tank-caption"><Icon name="shield" size={16} /> Your loan</div>
        <div className="tank-value num">{percent(ratioBps)}</div>
      </div>
    </div>
  );
}
