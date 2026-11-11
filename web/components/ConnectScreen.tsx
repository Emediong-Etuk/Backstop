'use client';
import { useState } from 'react';
import QRCode from 'qrcode';
import { connectWalletConnect, walletConnectConfigured } from '../lib/walletconnect';
import type { WalletSession } from '../lib/wallet';

export function ConnectScreen({ onConnected }: { onConnected: (wallet: WalletSession) => void }) {
  const [uri, setUri] = useState<string>();
  const [qr, setQr] = useState<string>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);

  async function connect() {
    setError(undefined);
    try {
      const wallet = await connectWalletConnect(async (link) => {
        setUri(link);
        setQr(await QRCode.toDataURL(link, { margin: 1, width: 480 }));
      });
      onConnected(wallet);
    } catch (e) {
      setUri(undefined);
      setError((e as Error).message);
    }
  }

  return (
    <>
      <section className="hero">
        <h1>Don&rsquo;t lose your loan while you sleep.</h1>
        <p>
          If the price of BCH falls fast, your ParyonUSD loan can be liquidated, and you lose all of the BCH you put up for it.
          Backstop keeps some of your BCH ready as a reserve. If your loan gets close to the danger line, part of that reserve
          moves into your loan automatically, even while you are offline.
        </p>
        <ul className="points">
          <li>One signature to set it up.</li>
          <li>Nothing to sign when a rescue happens, and no spare BCH needed.</li>
          <li>Take everything back at any time with one signature. Nobody else can.</li>
        </ul>
      </section>

      <div className="card">
        {!uri ? (
          <>
            <h2>Connect your wallet</h2>
            <p className="muted">Use a Bitcoin Cash wallet that supports WalletConnect, such as Cashonize, set to the chipnet test network.</p>
            {walletConnectConfigured()
              ? <button onClick={connect}>Connect wallet</button>
              : <p className="banner">This copy of the site has no WalletConnect project ID, so wallets cannot connect. Try the <a href="?preview">local preview</a> instead.</p>}
          </>
        ) : (
          <div className="qr">
            <h2>Scan with your wallet</h2>
            {qr && <img src={qr} alt="WalletConnect QR code" />}
            <p className="muted small">Or copy the link and paste it into Cashonize under WalletConnect.</p>
            <div className="actions">
              <button className="secondary" onClick={async () => { await navigator.clipboard.writeText(uri); setCopied(true); }}>
                {copied ? 'Link copied' : 'Copy link'}
              </button>
              <button className="link" onClick={() => setUri(undefined)}>Cancel</button>
            </div>
          </div>
        )}
        {error && <p className="banner error" role="alert">{error}</p>}
      </div>
    </>
  );
}
