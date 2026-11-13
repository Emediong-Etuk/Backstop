'use client';
// The idea of Backstop in one looping picture: BCH falls, the loan nears its rescue level,
// BCH flows from the reserve into the loan, and the loan recovers. Decorative only.

const LOOP = '9s';

export function HeroScene() {
  return (
    <div className="scene" aria-hidden="true">
      <svg viewBox="0 0 560 280" className="scene-svg">
        <defs>
          <linearGradient id="scene-line" x1="0" x2="1">
            <stop offset="0" stopColor="var(--accent-2)" />
            <stop offset="0.55" stopColor="var(--warn)" />
            <stop offset="1" stopColor="var(--accent)" />
          </linearGradient>
          <linearGradient id="scene-liquid" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--accent-2)" />
            <stop offset="1" stopColor="var(--accent)" />
          </linearGradient>
          <linearGradient id="scene-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.25" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
          <clipPath id="scene-tank-reserve"><rect x="398" y="110" width="54" height="130" rx="14" /></clipPath>
          <clipPath id="scene-tank-loan"><rect x="488" y="110" width="54" height="130" rx="14" /></clipPath>
        </defs>

        {/* chart grid */}
        {[60, 105, 150, 195, 240].map((y) => <line key={y} x1="24" x2="356" y1={y} y2={y} className="scene-grid" />)}

        {/* levels */}
        <line x1="24" x2="356" y1="150" y2="150" className="scene-level rescue" />
        <text x="28" y="144" className="scene-label">Rescue level</text>
        <line x1="24" x2="356" y1="205" y2="205" className="scene-level liquidation" />
        <text x="28" y="222" className="scene-label danger">Liquidation</text>

        {/* the loan's health over time */}
        <path className="scene-price" pathLength={1}
          d="M30 88 C 70 66, 96 108, 130 94 S 180 120, 205 150 S 236 180, 250 174 S 292 112, 350 92" />
        <text x="30" y="40" className="scene-label">Your loan&rsquo;s health</text>

        {/* the moment of rescue */}
        <g className="scene-shield" transform="translate(250 174)">
          <circle r="22" className="scene-pulse" />
          <circle r="22" className="scene-pulse two" />
          <path d="M0 -14 -10 -10v7c0 6 4 11 10 13 6-2 10-7 10-13v-7Z" className="scene-shield-body" />
          <path d="m-4 -2 3 3 5-6" className="scene-shield-check" />
        </g>

        {/* reserve and loan */}
        <g clipPath="url(#scene-tank-reserve)">
          <rect x="398" y="110" width="54" height="130" className="scene-tank-bg" />
          <rect x="398" y="140" width="54" height="100" className="scene-fill reserve" fill="url(#scene-liquid)" />
        </g>
        <rect x="398" y="110" width="54" height="130" rx="14" className="scene-tank" />
        <text x="425" y="262" className="scene-label middle">Reserve</text>

        <g clipPath="url(#scene-tank-loan)">
          <rect x="488" y="110" width="54" height="130" className="scene-tank-bg" />
          <rect x="488" y="170" width="54" height="70" className="scene-fill loan" fill="url(#scene-liquid)" />
        </g>
        <rect x="488" y="110" width="54" height="130" rx="14" className="scene-tank" />
        <text x="515" y="262" className="scene-label middle">Your loan</text>

        <path d="M425 128 Q 470 52 515 128" className="scene-pipe" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <circle key={i} r="5" className="scene-drop">
            <animateMotion dur={LOOP} repeatCount="indefinite" path="M425 128 Q 470 52 515 128"
              keyPoints="0;0;1;1" keyTimes={`0;${(0.4 + i * 0.03).toFixed(2)};${(0.52 + i * 0.03).toFixed(2)};1`} calcMode="linear" />
            <animate attributeName="opacity" dur={LOOP} repeatCount="indefinite"
              values="0;0;1;1;0;0" keyTimes={`0;${(0.39 + i * 0.03).toFixed(2)};${(0.41 + i * 0.03).toFixed(2)};${(0.5 + i * 0.03).toFixed(2)};${(0.53 + i * 0.03).toFixed(2)};1`} />
          </circle>
        ))}

        {/* what is happening, in words */}
        <g className="scene-status">
          <g className="scene-chip s1"><rect x="24" y="250" width="150" height="24" rx="12" /><text x="99" y="266" className="middle">BCH is falling…</text></g>
          <g className="scene-chip s2 warn"><rect x="24" y="250" width="150" height="24" rx="12" /><text x="99" y="266" className="middle">Rescue on its way</text></g>
          <g className="scene-chip s3 ok"><rect x="24" y="250" width="150" height="24" rx="12" /><text x="99" y="266" className="middle">Loan back to safety</text></g>
        </g>
      </svg>
    </div>
  );
}
