import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Backstop',
  description: 'A safety net for your ParyonUSD loan: a BCH reserve that tops up your collateral before liquidation.',
  icons: { icon: 'icon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#070b10' },
    { media: '(prefers-color-scheme: light)', color: '#f4f7fb' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Slowly drifting colour behind everything. Decorative only. */}
        <div className="aurora" aria-hidden="true"><span /><span /><span /></div>
        <div className="grain" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
