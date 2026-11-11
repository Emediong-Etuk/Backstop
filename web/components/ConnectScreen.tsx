'use client';
import { useState } from 'react';
import QRCode from 'qrcode';
import { connectWalletConnect, walletConnectConfigured } from '../lib/walletconnect';
import { connectWizardConnect } from '../lib/wizardconnect';
import type { Chain } from '../lib/chain';
import type { WalletSession } from '../lib/wallet';

type Pairing = { protocol: 'WalletConnect' | 'WizardConnect'; uri: string; qr?: string };

export function ConnectScreen({ chain, onConnected }: { chain: Chain; onConnected: (wallet: WalletSession) => void }) {
  const [pairing, setPairing] = useState<Pairing>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);

  async function connect(protocol: Pairing['protocol']) {
    setError(undefined);
    setCopied(false);
    setBusy(true);
    const show = async (uri: string) => setPairing({ protocol, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 480 }) });
    try {
      const wallet = protocol === 'WalletConnect'
        ? await connectWalletConnect(show)
        : await connectWizardConnect(show, chain.provider, { prefix: chain.kind === 'chipnet' ? 'bchtest' : 'bitcoincash', dappIcon: new URL('icon.svg', window.location.href).toString() });
      onConnected(wallet);
    } catch (e) {
      setPairing(undefined);
      setError((e as Error).message);
    } finally {
      setBusy(false);
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
        {!pairing ? (
          <>
            <h2>Connect your wallet</h2>
            <p className="muted">Use a Bitcoin Cash wallet on the chipnet test network.</p>
            <div className="actions">
              <button onClick={() => connect('WizardConnect')} disabled={busy}>Connect with WizardConnect</button>
              {walletConnectConfigured() && (
                <button className="secondary" onClick={() => connect('WalletConnect')} disabled={busy}>Connect with WalletConnect</button>
              )}
            </div>
            <p className="muted small" style={{ marginTop: 12 }}>
              WizardConnect works with HD wallets that support it. WalletConnect works with wallets such as Cashonize
              {walletConnectConfigured() ? '' : ' (not set up on this copy of the site)'}. Or try the <a href="?preview">local preview</a>.
            </p>
          </>
        ) : (
          <div className="qr">
            <h2>Scan with your wallet</h2>
            {pairing.qr && <img src={pairing.qr} alt={`${pairing.protocol} QR code`} />}
            <p className="muted small">
              {pairing.protocol === 'WizardConnect'
                ? 'Scan with a WizardConnect wallet, or open the link on the device that has your wallet.'
                : 'Or copy the link and paste it into Cashonize under WalletConnect.'}
            </p>
            <div className="actions">
              <button className="secondary" onClick={async () => { await navigator.clipboard.writeText(pairing.uri); setCopied(true); }}>
                {copied ? 'Link copied' : 'Copy link'}
              </button>
              {pairing.protocol === 'WizardConnect' && <a className="button secondary" href={pairing.uri}>Open in wallet</a>}
              <button className="link" onClick={() => { setPairing(undefined); setBusy(false); }}>Cancel</button>
            </div>
          </div>
        )}
        {error && <p className="banner error" role="alert">{error}</p>}
      </div>
    </>
  );
}
