'use client';
import { useCallback, useEffect, useState } from 'react';
import { connectChipnet, isPreviewMode, NoDeploymentError, type Chain } from '../lib/chain';
import { protectLoan, readPosition, withdrawEverything, type Position, type ProtectionChoices } from '../lib/actions';
import { restoreWalletConnect } from '../lib/walletconnect';
import type { WalletSession } from '../lib/wallet';
import type { PreviewControls } from '../lib/preview';
import { usd, shortId } from '../lib/format';
import { ConnectScreen } from '../components/ConnectScreen';
import { SetupScreen } from '../components/SetupScreen';
import { StatusScreen } from '../components/StatusScreen';
import { PreviewPanel } from '../components/PreviewPanel';

export default function Home() {
  const [chain, setChain] = useState<Chain>();
  const [chainError, setChainError] = useState<string>();
  const [wallet, setWallet] = useState<WalletSession>();
  const [position, setPosition] = useState<Position>();
  const [readError, setReadError] = useState<string>();
  const [notice, setNotice] = useState<{ text: string; txid?: string }>();
  const [preview, setPreview] = useState<PreviewControls>();

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
        setChain(await connectChipnet());
        const restored = await restoreWalletConnect().catch(() => undefined);
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
    const loan = position!.loans[0];
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
    <main>
      <header className="topbar">
        <div className="brand">
          <img src="icon.svg" alt="" width={28} height={28} />
          Backstop
        </div>
        <div className="actions">
          {position && <span className="pill num" title={chain?.kind === 'preview' ? 'Local preview price' : 'Price from the demo oracle on chipnet'}>BCH {usd(position.priceCents)}{chain?.kind === 'chipnet' ? ' · demo price feed' : ''}</span>}
          <span className="pill warn">{chain?.kind === 'preview' ? 'Local preview' : 'Chipnet test network'}</span>
          {wallet && wallet.kind === 'walletconnect' && (
            <button className="link small" onClick={async () => { await wallet.disconnect(); setWallet(undefined); setPosition(undefined); }}>
              Disconnect {shortId(wallet.address.split(':')[1] ?? wallet.address)}
            </button>
          )}
        </div>
      </header>

      {chain?.kind === 'preview' && (
        <p className="banner">Local preview: a test chain inside this page with a demo loan and a test wallet. Nothing here is real or leaves your browser.</p>
      )}
      {chain?.kind === 'chipnet' && (
        <p className="banner">Test network only. Prices come from a <strong>demo price feed</strong> that this project controls, so the price can be moved for the demo. The main network would use the General Protocols price oracle.</p>
      )}
      {chainError && <p className="banner error" role="alert">{chainError} <a href="?preview">Try the local preview.</a></p>}
      {readError && <p className="banner error" role="alert">{readError}</p>}
      {notice && (
        <p className="banner ok" role="status">
          {notice.text} {notice.txid && chain?.explorerTx && <a href={chain.explorerTx(notice.txid)} target="_blank" rel="noreferrer">See the transaction</a>}
        </p>
      )}

      {!wallet && chain && <ConnectScreen onConnected={setWallet} />}
      {wallet && !position && !readError && <p className="muted">Reading your loan from the chain…</p>}

      {wallet && position && activeVault && (
        <StatusScreen view={activeVault} priceCents={position.priceCents} explorerTx={chain?.explorerTx} onWithdraw={withdraw} />
      )}
      {wallet && position && !activeVault && position.loans[0] && (
        <SetupScreen key={position.loans[0].loanKeyCategory} loan={position.loans[0]} priceCents={position.priceCents} walletBchSats={position.walletBchSats} onProtect={protect} />
      )}
      {wallet && position && !activeVault && !position.loans[0] && (
        <div className="card">
          <h2>No ParyonUSD loan in this wallet</h2>
          <p className="muted">Backstop protects a loan whose loan key is in the connected wallet. Connect the wallet that holds your loan key.</p>
        </div>
      )}

      {preview && <PreviewPanel controls={preview} onChange={async () => { setNotice(undefined); await refresh(); }} />}

      <footer>
        Backstop is a hackathon project for BCH BLAZE 2026. Your BCH is held by an on-chain contract, not by this site:
        the site keeps no data and has no server.
      </footer>
    </main>
  );
}
