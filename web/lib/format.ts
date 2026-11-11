const SATS = 100_000_000;

/**
 * "0.25 BCH" with at most `digits` decimals (rounded down, so it never shows more than there is)
 * and no trailing zeros beyond two decimals.
 */
export function bch(sats: bigint, digits = 8): string {
  const negative = sats < 0n;
  const abs = negative ? -sats : sats;
  const whole = abs / BigInt(SATS);
  const frac = (abs % BigInt(SATS)).toString().padStart(8, '0').slice(0, digits).replace(/0+$/, '').padEnd(2, '0');
  return `${negative ? '-' : ''}${whole}.${frac} BCH`;
}

export function usd(cents: bigint): string {
  return `$${(Number(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Dollar value of an amount of BCH at a price in cents per BCH. */
export function usdOf(sats: bigint, priceCents: bigint): string {
  return usd((sats * priceCents) / BigInt(SATS));
}

export function percent(bps: bigint): string {
  const value = Number(bps) / 100;
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`;
}

export function parseBch(text: string): bigint | undefined {
  const match = text.trim().match(/^(\d*)(?:\.(\d{0,8}))?$/);
  if (!match || (match[1] === '' && !match[2])) return undefined;
  return BigInt(match[1] || '0') * BigInt(SATS) + BigInt((match[2] ?? '').padEnd(8, '0'));
}

export function shortId(hex: string): string {
  return `${hex.slice(0, 8)}…${hex.slice(-6)}`;
}

export function blocksAsTime(blocks: bigint): string {
  const minutes = Number(blocks) * 10;
  if (minutes < 60) return `about ${minutes} minutes`;
  const hours = minutes / 60;
  return `about ${Number.isInteger(hours) ? hours : hours.toFixed(1)} hour${hours === 1 ? '' : 's'}`;
}
