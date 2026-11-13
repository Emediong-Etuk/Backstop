'use client';
import { useState } from 'react';
import QRCode from 'qrcode';
import { connectWalletConnect, walletConnectConfigured } from '../lib/walletconnect';
import { connectWizardConnect } from '../lib/wizardconnect';
import type { Chain } from '../lib/chain';
import type { WalletSession } from '../lib/wallet';
import { HeroScene } from './HeroScene';
import { Icon, Reveal } from './ui';

type Pairing = { protocol: 'WalletConnect' | 'WizardConnect'; uri: string; qr?: string };

const steps = [
  { icon: 'coins' as const, title: 'Set aside a reserve', text: 'Choose how much BCH to keep ready. Your loan key and the reserve move into your own vault with one signature.' },
  { icon: 'eye' as const, title: 'Anyone can watch', text: 'Keepers watch the BCH price around the clock. No account, no server, no app that has to stay open.' },
  { icon: 'bolt' as const, title: 'The rescue lands', text: 'If your loan nears liquidation, part of the reserve moves into your loan. You sign nothing, and it is fully automatic.' },
];

const guarantees = [
  { icon: 'lock' as const, title: 'Only you can take it out', text: 'Withdraw your loan key and reserve at any time with one signature. Nobody else can.' },
  { icon: 'shield' as const, title: 'Rescues only help you', text: 'A rescue can only move BCH into your own loan, within the limits you set. The rules are enforced by the network itself.' },
  { icon: 'chart' as const, title: 'Real prices only', text: 'Rescues use the same signed price feed as ParyonUSD itself, checked on chain. An old price cannot be replayed.' },
];

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
    <div className="screen">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow"><Icon name="sparkle" size={14} /> A safety net for ParyonUSD loans</span>
          <h1>Don&rsquo;t lose your loan <span className="gradient-text">while you sleep.</span></h1>
          <p className="lead">
            If BCH falls fast, your ParyonUSD loan can be liquidated and you lose all the BCH behind it.
            Backstop keeps a reserve ready and moves it into your loan automatically, even while you are offline.
          </p>
          <ul className="points">
            <li><Icon name="check" size={18} /> One signature to set it up</li>
            <li><Icon name="check" size={18} /> Nothing to sign when a rescue happens</li>
            <li><Icon name="check" size={18} /> Take everything back at any time</li>
          </ul>
        </div>
        <HeroScene />
      </section>

      <div className="card connect-card glow">
        {!pairing ? (
          <>
            <div className="card-head">
              <span className="badge-icon"><Icon name="wallet" /></span>
              <div>
                <h2>Connect your wallet</h2>
                <p className="muted">Use a Bitcoin Cash wallet on the chipnet test network.</p>
              </div>
            </div>
            <div className="wallet-options">
              <button className="wallet-option" onClick={() => connect('WizardConnect')} disabled={busy}>
                <span className="wallet-icon"><Icon name="qr" /></span>
                <span className="wallet-text"><strong>Connect with WizardConnect</strong><small>HD wallets such as Cashonize</small></span>
                <Icon name="arrow" className="wallet-arrow" />
              </button>
              {walletConnectConfigured() && (
                <button className="wallet-option" onClick={() => connect('WalletConnect')} disabled={busy}>
                  <span className="wallet-icon"><Icon name="link" /></span>
                  <span className="wallet-text"><strong>Connect with WalletConnect</strong><small>Paste a link into your wallet</small></span>
                  <Icon name="arrow" className="wallet-arrow" />
                </button>
              )}
            </div>
            <p className="muted small">
              {walletConnectConfigured() ? '' : 'WalletConnect is not set up on this copy of the site. '}
              No wallet handy? <a href="?preview">Try the local preview</a>, a test chain that runs inside this page.
            </p>
          </>
        ) : (
          <div className="qr">
            <h2>Scan with your wallet</h2>
            {pairing.qr && (
              <div className="qr-frame">
                <img src={pairing.qr} alt={`${pairing.protocol} QR code`} />
                <span className="qr-scan" aria-hidden="true" />
              </div>
            )}
            <p className="muted small">
              {pairing.protocol === 'WizardConnect'
                ? 'Scan with a WizardConnect wallet, or open the link on the device that has your wallet.'
                : 'Or copy the link and paste it into Cashonize under WalletConnect.'}
            </p>
            <div className="actions center">
              <button className="secondary" onClick={async () => { await navigator.clipboard.writeText(pairing.uri); setCopied(true); }}>
                <Icon name={copied ? 'check' : 'copy'} size={16} /> {copied ? 'Link copied' : 'Copy link'}
              </button>
              {pairing.protocol === 'WizardConnect' && <a className="button secondary" href={pairing.uri}><Icon name="link" size={16} /> Open in wallet</a>}
              <button className="link" onClick={() => { setPairing(undefined); setBusy(false); }}>Cancel</button>
            </div>
            <p className="waiting"><span className="spinner" /> Waiting for your wallet…</p>
          </div>
        )}
        {error && <p className="banner error" role="alert">{error}</p>}
      </div>

      <section className="section">
        <Reveal><h2 className="section-title">How it works</h2></Reveal>
        <div className="steps">
          {steps.map((s, i) => (
            <Reveal key={s.title} delay={i * 120}>
              <div className="step">
                <span className="step-number">{i + 1}</span>
                <span className="step-icon"><Icon name={s.icon} size={22} /></span>
                <h3>{s.title}</h3>
                <p className="muted">{s.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="section">
        <Reveal><h2 className="section-title">Why you can trust it</h2></Reveal>
        <div className="guarantees">
          {guarantees.map((g, i) => (
            <Reveal key={g.title} delay={i * 120}>
              <div className="guarantee">
                <span className="guarantee-icon"><Icon name={g.icon} size={22} /></span>
                <div><h3>{g.title}</h3><p className="muted">{g.text}</p></div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>
    </div>
  );
}
