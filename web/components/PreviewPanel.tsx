'use client';
import { useState } from 'react';
import type { PreviewControls } from '../lib/preview';

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
      <h3>Preview controls</h3>
      <p className="muted small">These play the outside world: the demo price feed, miners and a keeper.</p>
      <div className="actions">
        {[285, 265, 240].map((usd) => (
          <button key={usd} className="secondary" disabled={busy} onClick={() => run(`BCH price falls to $${usd}`, () => controls.setPrice(BigInt(usd * 100)))}>
            Price to ${usd}
          </button>
        ))}
        <button className="secondary" disabled={busy} onClick={() => run('a block is mined', () => controls.mine(1))}>Mine a block</button>
        <button disabled={busy} onClick={() => run('a keeper checks every vault', () => controls.runKeeper())}>Run a keeper</button>
      </div>
      {log.length > 0 && <div className="log" aria-live="polite">{log.join('\n')}</div>}
    </div>
  );
}
