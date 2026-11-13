'use client';
// How far BCH can fall before the loan is liquidated, without and with the reserve.
// Redraws live as the borrower drags the reserve slider.
import { usd } from '../lib/format';
import { useTweened } from './ui';

export function PriceScale({ priceCents, liquidationCents, protectedToCents, rescueCents }: {
  priceCents: bigint;
  liquidationCents: bigint;
  protectedToCents: bigint;
  rescueCents: bigint;
}) {
  const price = Number(priceCents);
  const low = Math.min(Number(protectedToCents), Number(liquidationCents)) * 0.82;
  const high = price * 1.06;
  const at = (cents: number) => Math.min(100, Math.max(0, ((cents - low) / (high - low)) * 100));
  const liq = useTweened(at(Number(liquidationCents)), 600);
  const safe = useTweened(at(Number(protectedToCents)), 600);
  const rescue = at(Number(rescueCents));
  const now = at(price);
  const extra = Number(liquidationCents) - Number(protectedToCents);
  const extraPct = Number(liquidationCents) > 0 ? Math.max(0, Math.round((extra / price) * 100)) : 0;

  return (
    <div className="scale" role="img"
      aria-label={`Without Backstop your loan is liquidated below ${usd(liquidationCents)}. With this reserve it can absorb a fall to about ${usd(protectedToCents)}.`}>
      <div className="scale-row">
        <div className="scale-name">Without Backstop</div>
        <div className="scale-track">
          <div className="scale-zone lost" style={{ width: `${liq}%` }} />
          <div className="scale-pin danger" style={{ left: `${liq}%` }}><span>{usd(liquidationCents)}</span></div>
          <div className="scale-now" style={{ left: `${now}%` }} />
        </div>
      </div>
      <div className="scale-row">
        <div className="scale-name">With Backstop</div>
        <div className="scale-track">
          <div className="scale-zone lost" style={{ width: `${safe}%` }} />
          <div className="scale-zone covered" style={{ left: `${safe}%`, width: `${Math.max(0, liq - safe)}%` }} />
          <div className="scale-pin safe" style={{ left: `${safe}%` }}><span>{usd(protectedToCents)}</span></div>
          <div className="scale-tick" style={{ left: `${rescue}%` }} title={`Rescue starts below ${usd(rescueCents)}`} />
          <div className="scale-now" style={{ left: `${now}%` }} />
        </div>
      </div>
      <div className="scale-legend">
        <span><i className="dot now" /> BCH now {usd(priceCents)}</span>
        <span><i className="dot rescue" /> rescue starts {usd(rescueCents)}</span>
        {extraPct > 0 && <span className="scale-gain">+{extraPct}% more room to fall</span>}
      </div>
    </div>
  );
}
