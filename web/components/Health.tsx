import { percent } from '../lib/format';

/**
 * Loan health on one line: where liquidation happens (110%), where a rescue starts,
 * where a rescue lifts the loan to, and where the loan is now.
 */
export function HealthBar({ ratioBps, triggerBps, targetBps }: { ratioBps: bigint; triggerBps: bigint; targetBps?: bigint }) {
  const min = 10_000;
  const max = Number(targetBps ?? triggerBps) + 3_000;
  const pos = (bps: bigint | number) => `${Math.min(100, Math.max(0, ((Number(bps) - min) / (max - min)) * 100))}%`;
  return (
    <div className="health" role="img" aria-label={`Loan health ${percent(ratioBps)}. Liquidation at 110%, rescue below ${percent(triggerBps)}.`}>
      <div className="health-track">
        <div className="health-mark danger" style={{ left: pos(11_000) }} />
        <div className="health-mark" style={{ left: pos(triggerBps) }} />
        {targetBps !== undefined && <div className="health-mark" style={{ left: pos(targetBps) }} />}
        <div className="health-dot" style={{ left: pos(ratioBps) }} />
      </div>
      <div className="health-labels">
        <span style={{ left: pos(11_000) }}>Liquidation<br />110%</span>
        <span style={{ left: pos(triggerBps) }}>Rescue<br />{percent(triggerBps)}</span>
        {targetBps !== undefined && <span style={{ left: pos(targetBps) }}>Back to<br />{percent(targetBps)}</span>}
      </div>
    </div>
  );
}
