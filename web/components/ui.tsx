'use client';
// Small building blocks for the interface: animated numbers, scroll reveals, icons, confetti.
// No animation library: CSS does the motion, and everything respects "reduce motion".
import { useEffect, useRef, useState, type ReactNode } from 'react';

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

/** A number that glides to its new value instead of jumping. */
export function useTweened(target: number, durationMs = 900): number {
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState(target);
  const from = useRef(target);
  const current = useRef(target);
  useEffect(() => {
    if (reduced) { current.current = target; setValue(target); return; }
    from.current = current.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from.current + (target - from.current) * eased;
      current.current = next;
      setValue(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs, reduced]);
  return value;
}

/** Shows `value` (a bigint amount) through `format`, counting smoothly between changes. */
export function Tween({ value, format }: { value: bigint; format: (v: bigint) => string }) {
  const shown = useTweened(Number(value));
  return <span className="num">{format(BigInt(Math.round(shown)))}</span>;
}

/** Fades and lifts its children in when they scroll into view. */
export function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') { setShown(true); return; }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setShown(true); observer.disconnect(); }
    }, { threshold: 0 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal ${shown ? 'is-shown' : ''} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/** A short burst of confetti, for a rescue that just landed. */
export function Confetti({ burst }: { burst: number }) {
  const reduced = usePrefersReducedMotion();
  const [pieces, setPieces] = useState<Array<{ id: number; left: number; delay: number; hue: number; drift: number; spin: number }>>([]);
  useEffect(() => {
    if (burst === 0 || reduced) return;
    const made = Array.from({ length: 42 }, (_, i) => ({
      id: burst * 100 + i,
      left: Math.random() * 100,
      delay: Math.random() * 250,
      hue: [152, 186, 45, 265][i % 4],
      drift: (Math.random() - 0.5) * 160,
      spin: (Math.random() - 0.5) * 720,
    }));
    setPieces(made);
    const timer = setTimeout(() => setPieces([]), 2600);
    return () => clearTimeout(timer);
  }, [burst, reduced]);
  if (pieces.length === 0) return null;
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p) => (
        <i key={p.id} style={{
          left: `${p.left}%`, animationDelay: `${p.delay}ms`, background: `hsl(${p.hue} 85% 60%)`,
          ['--drift' as string]: `${p.drift}px`, ['--spin' as string]: `${p.spin}deg`,
        }} />
      ))}
    </div>
  );
}

type IconName = 'shield' | 'bolt' | 'coins' | 'key' | 'clock' | 'chart' | 'eye' | 'lock' | 'arrow' | 'check' | 'alert' | 'wallet' | 'link' | 'qr' | 'copy' | 'drop' | 'sparkle' | 'exit';

const paths: Record<IconName, ReactNode> = {
  shield: <path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.4 7.5 9.5 4.4-1.1 7.5-4.9 7.5-9.5V6L12 3Z" />,
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />,
  coins: <><ellipse cx="9" cy="7" rx="6" ry="3" /><path d="M3 7v4c0 1.7 2.7 3 6 3s6-1.3 6-3V7" /><path d="M9 14v3c0 1.7 2.7 3 6 3s6-1.3 6-3v-4c0-1.7-2.7-3-6-3" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9m-3 3 3 3m-6 0 2 2" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  chart: <path d="M3 3v18h18M7 14l4-4 3 3 5-6" />,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  lock: <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  check: <path d="m5 12 5 5L20 7" />,
  alert: <><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4m0 3h.01" /></>,
  wallet: <><rect x="3" y="6" width="18" height="14" rx="3" /><path d="M3 10h18M16 15h2" /></>,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  qr: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" /></>,
  copy: <><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
  drop: <path d="M12 3s7 7.5 7 12a7 7 0 0 1-14 0c0-4.5 7-12 7-12Z" />,
  sparkle: <path d="M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M6 18l2.5-2.5m7-7L18 6" />,
  exit: <path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H4" />,
};

export function Icon({ name, size = 20, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
