'use client';
import { useState } from 'react';
import type { PreviewControls } from '../lib/preview';
import { Icon } from './ui';

/** Only in local preview: stand-ins for the outside world (price feed, miners, keepers). */
export function PreviewPanel({ controls, onChange }: { controls: PreviewControls; onChange: () => Promise<void> }) {
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const run = async (label: string, action: () => Promise<string[] | void>) => {
    setBusy(true);
    try {
      const lines = (await action()) ?? [];
      setLog((l) => [...l, `> ${label}`, ...lines].slice(-12));
      await onChange();
    } catch (e) {
      setLog((l) => [...l, `> ${label}`, `failed: ${(e as Error).message}`].slice(-12));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card preview-panel">
      <div className="card-head">
        <span className="badge-icon"><Icon name="sparkle" /></span>
        <div>
          <h3>Preview controls</h3>
          <p className="muted small">These play the outside world: the demo price feed, miners and a keeper.</p>
        </div>
      </div>
      <div className="preview-groups">
        <div className="preview-group">
          <span className="label-text">BCH price</span>
          <div className="actions">
            {[285, 265, 240].map((usd) => (
              <button key={usd} className="secondary small-button" disabled={busy} onClick={() => run(`BCH price falls to $${usd}`, () => controls.setPrice(BigInt(usd * 100)))}>
                Price to ${usd}
              </button>
            ))}
          </div>
        </div>
        <div className="preview-group">
          <span className="label-text">Network</span>
          <div className="actions">
            <button className="secondary small-button" disabled={busy} onClick={() => run('a block is mined', () => controls.mine(1))}>Mine a block</button>
            <button className="primary small-button" disabled={busy} onClick={() => run('a keeper checks every vault', () => controls.runKeeper())}>Run a keeper</button>
          </div>
        </div>
      </div>
      {log.length > 0 && <div className="log" aria-live="polite">{log.join('\n')}</div>}
    </div>
  );
}
