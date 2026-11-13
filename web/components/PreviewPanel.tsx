'use client';
import { useState } from 'react';
import { ATTACKS, type AttackKind } from '@backstop/contracts';
import type { AttackResult, PreviewControls } from '../lib/preview';
import { Icon } from './ui';

/** Only in local preview: stand-ins for the outside world (price feed, miners, keepers), and attacks to try. */
export function PreviewPanel({ controls, onChange, canAttack }: { controls: PreviewControls; onChange: () => Promise<void>; canAttack: boolean }) {
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [attack, setAttack] = useState<AttackResult & { error?: string }>();
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
  const tryAttack = async (kind: AttackKind) => {
    setBusy(true);
    setAttack(undefined);
    try {
      const result = await controls.attack(kind);
      setAttack(result);
      setLog((l) => [...l, `> attack: ${ATTACKS[kind].title.toLowerCase()}`, result.refused ? `REFUSED: ${result.message}` : result.message].slice(-12));
      await onChange();
    } catch (e) {
      setAttack({ kind, refused: false, message: '', node: '', error: (e as Error).message });
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

      <div className="attack-zone">
        <div className="attack-head">
          <span className="attack-icon"><Icon name="alert" size={18} /></span>
          <div>
            <h3>Try to break it</h3>
            <p className="muted small">Play a malicious keeper. Each attack is a real rescue transaction with one change, checked by the contract and sent to the node.</p>
          </div>
        </div>
        <div className="actions">
          {(Object.keys(ATTACKS) as AttackKind[]).map((kind) => (
            <button key={kind} className="secondary small-button attack-button" disabled={busy || !canAttack} onClick={() => tryAttack(kind)}>
              {ATTACKS[kind].title}
            </button>
          ))}
        </div>
        {!canAttack && <p className="muted small">Protect the loan first: then there is a vault to attack.</p>}
        {attack && (
          <div className={`attack-result ${attack.refused ? 'refused' : 'failed'}`} role="status" key={`${attack.kind}-${attack.message}`}>
            {attack.error ? (
              <p>{attack.error}</p>
            ) : (
              <>
                <div className="attack-verdict">
                  <span className="attack-stamp"><Icon name={attack.refused ? 'shield' : 'alert'} size={18} /> {attack.refused ? 'Refused' : 'Not refused'}</span>
                  <strong>{ATTACKS[attack.kind].title}</strong>
                </div>
                <p className="muted small">{ATTACKS[attack.kind].what}</p>
                <div className="attack-proof">
                  <div><span className="label-text">Backstop.cash{attack.line ? ` line ${attack.line}` : ''}</span><code>require(…, &quot;{attack.message}&quot;)</code></div>
                  <div><span className="label-text">The node</span><code>{attack.node === 'accepted' ? 'accepted (this should never happen)' : `rejected: ${attack.node}`}</code></div>
                </div>
                <p className="small attack-note">{ATTACKS[attack.kind].paryonAlone} Backstop refuses it on its own. The borrower&rsquo;s BCH did not move.</p>
              </>
            )}
          </div>
        )}
      </div>

      {log.length > 0 && <div className="log" aria-live="polite">{log.join('\n')}</div>}
    </div>
  );
}
