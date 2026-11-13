'use client';
import { useCallback, useEffect, useState } from 'react';
import { connectChipnet, isPreviewMode, NoDeploymentError, type Chain } from '../lib/chain';
import { protectLoan, readPosition, withdrawEverything, type Position, type ProtectionChoices } from '../lib/actions';
import { restoreWalletConnect } from '../lib/walletconnect';
import { restoreWizardConnect } from '../lib/wizardconnect';
import type { WalletSession } from '../lib/wallet';
import type { PreviewControls } from '../lib/preview';
import { bch, usd, shortId } from '../lib/format';
import { ConnectScreen } from '../components/ConnectScreen';
import { SetupScreen } from '../components/SetupScreen';
import { StatusScreen } from '../components/StatusScreen';
import { PreviewPanel } from '../components/PreviewPanel';
import { Icon } from '../components/ui';

export default function Home() {
  const [chain, setChain] = useState<Chain>();
  const [chainError, setChainError] = useState<string>();
  const [wallet, setWallet] = useState<WalletSession>();
  const [position, setPosition] = useState<Position>();
  const [readError, setReadError] = useState<string>();
  const [notice, setNotice] = useState<{ text: string; txid?: string }>();
  const [preview, setPreview] = useState<PreviewControls>();
  const [loanIndex, setLoanIndex] = useState(0);

  // Connect to the network (or start the local preview), and restore an earlier wallet session.
  useEffect(() => {
    (async () => {
      try {
        if (isPreviewMode()) {
          const { startPreview } = await import('../lib/preview');
          const started = await startPreview();
          setChain(started.chain);
          setWallet(started.wallet);
          setPreview(started.controls);
          return;
        }
        const chipnet = await connectChipnet();
        setChain(chipnet);
        const restored = await restoreWalletConnect().catch(() => undefined)
          ?? await restoreWizardConnect(chipnet.provider, { prefix: 'bchtest' }).catch(() => undefined);
        if (restored) setWallet(restored);
      } catch (e) {
        setChainError(e instanceof NoDeploymentError
          ? 'This site has not been pointed at a chipnet deployment yet. Run "npm run demo:deploy", then rebuild.'
          : `Could not reach the chipnet network: ${(e as Error).message}`);
      }
    })();
  }, []);

  const refresh = useCallback(async () => {
    if (!chain || !wallet) return;
    try {
      setPosition(await readPosition(chain, wallet));
      setReadError(undefined);
    } catch (e) {
      setReadError((e as Error).message);
    }
  }, [chain, wallet]);

  useEffect(() => {
    void refresh();
    if (!chain || chain.kind === 'preview') return;
    const timer = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(timer);
  }, [chain, refresh]);

  // Success messages fade after a while; the screen itself shows the new state.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 12_000);
    return () => clearTimeout(timer);
  }, [notice]);

  const done = async (text: string, txid: string) => {
    setNotice({ text, txid });
    if (preview) await preview.mine(1);
    await refresh();
  };

  async function protect(choices: ProtectionChoices) {
    const loan = position!.loans[Math.min(loanIndex, position!.loans.length - 1)];
    const txid = await protectLoan(chain!, wallet!, loan, choices);
    await done('Your loan is now protected.', txid);
  }

  async function withdraw() {
    const view = position!.vaults.find((v) => v.active)!;
    const txid = await withdrawEverything(chain!, wallet!, view);
    await done('Your loan key and reserve are back in your wallet.', txid);
  }

  const activeVault = position?.vaults.find((v) => v.active);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark"><img src="icon.svg" alt="" width={30} height={30} /></span>
            <span>Backstop</span>
          </div>
          <div className="topbar-actions">
            {position && (
              <span className="pill price-pill num" title={chain?.kind === 'preview' ? 'Local preview price' : 'Price from the demo oracle on chipnet'}>
                <span className="live-dot" /> BCH {usd(position.priceCents)}{chain?.kind === 'chipnet' ? <span className="pill-note"> · demo price feed</span> : ''}
              </span>
            )}
            <span className="pill warn">{chain?.kind === 'preview' ? 'Local preview' : 'Chipnet test network'}</span>
            {wallet && wallet.kind !== 'preview' && (
              <button className="pill wallet-pill" onClick={async () => { await wallet.disconnect(); setWallet(undefined); setPosition(undefined); }}>
                <span className="wallet-dot" /> Disconnect {shortId(wallet.address.split(':')[1] ?? wallet.address)}
              </button>
            )}
          </div>
        </div>
      </header>

      <main>
        {chain?.kind === 'preview' && (
          <p className="banner info">Local preview: a test chain inside this page with a demo loan and a test wallet. Nothing here is real or leaves your browser.</p>
        )}
        {chain?.kind === 'chipnet' && (
          <p className="banner info">Test network only. Prices come from a <strong>demo price feed</strong> that this project controls, so the price can be moved for the demo. The main network would use the General Protocols price oracle.</p>
        )}
        {chainError && <p className="banner error" role="alert">{chainError} <a href="?preview">Try the local preview.</a></p>}
        {readError && <p className="banner error" role="alert">{readError}</p>}

        {!chain && !chainError && <Skeleton label="Connecting to the network…" />}
        {!wallet && chain && <ConnectScreen chain={chain} onConnected={setWallet} />}
        {wallet && !position && !readError && <Skeleton label="Reading your loan from the chain…" />}

        {wallet && position && activeVault && (
          <StatusScreen view={activeVault} priceCents={position.priceCents} explorerTx={chain?.explorerTx} onWithdraw={withdraw} />
        )}
        {wallet && position && !activeVault && position.loans.length > 1 && (
          <div className="card loan-picker">
            <label htmlFor="loan">This wallet holds {position.loans.length} loans. Which one should Backstop protect?</label>
            <select id="loan" value={Math.min(loanIndex, position.loans.length - 1)} onChange={(e) => setLoanIndex(Number(e.target.value))}>
              {position.loans.map((loan, i) => (
                <option key={loan.loanKeyCategory} value={i}>{bch(loan.collateralSats, 4)} collateral, {usd(loan.debtCents)} borrowed (loan {shortId(loan.loanKeyCategory)})</option>
              ))}
            </select>
          </div>
        )}
        {wallet && position && !activeVault && position.loans[0] && (() => {
          const loan = position.loans[Math.min(loanIndex, position.loans.length - 1)];
          return <SetupScreen key={loan.loanKeyCategory} loan={loan} priceCents={position.priceCents} walletBchSats={position.walletBchSats} onProtect={protect} defaultCooldownBlocks={chain?.kind === 'preview' ? 1n : undefined} />;
        })()}
        {wallet && position && !activeVault && !position.loans[0] && (
          <div className="card empty-state">
            <span className="badge-icon"><Icon name="key" /></span>
            <h2>No ParyonUSD loan in this wallet</h2>
            <p className="muted">Backstop protects a loan whose loan key is in the connected wallet. Connect the wallet that holds your loan key.</p>
          </div>
        )}

        {preview && <PreviewPanel controls={preview} canAttack={!!activeVault} onChange={async () => { setNotice(undefined); await refresh(); }} />}

        <footer>
          <span className="brand-mini"><img src="icon.svg" alt="" width={18} height={18} /> Backstop</span>
          A hackathon project for BCH BLAZE 2026. Your BCH is held by an on-chain contract, not by this site:
          the site keeps no data and has no server.
        </footer>
      </main>

      {notice && (
        <div className="toast" role="status" key={notice.txid ?? notice.text}>
          <span className="toast-icon"><Icon name="check" size={18} /></span>
          <span>{notice.text} {notice.txid && chain?.explorerTx && <a href={chain.explorerTx(notice.txid)} target="_blank" rel="noreferrer">See the transaction</a>}</span>
          <button className="toast-close" aria-label="Dismiss" onClick={() => setNotice(undefined)}>×</button>
          <span className="toast-timer" />
        </div>
      )}
    </>
  );
}

function Skeleton({ label }: { label: string }) {
  return (
    <div className="screen" aria-busy="true">
      <p className="sr-only" role="status">{label}</p>
      <div className="card skeleton-card">
        <div className="skeleton line wide" />
        <div className="skeleton line" />
        <div className="skeleton-row"><div className="skeleton block" /><div className="skeleton block" /><div className="skeleton block" /></div>
      </div>
      <p className="muted small center">{label}</p>
    </div>
  );
}
