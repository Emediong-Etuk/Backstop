// Collateral-ratio arithmetic shared by the covenant tests, the keeper and the web app.
// Units: collateral in satoshis, debt in PUSD cents (PUSD has 2 decimals),
// price in US cents per BCH (as stored in Paryon's price contract).
// Every formula matches the integer arithmetic in Backstop.cash and Paryon's manage.cash.

export const SATS_PER_BCH = 100_000_000n;
export const BPS = 10_000n;
/** Paryon liquidates below 110% (manage.cash:97-99, liquidate.cash:57-63). */
export const PARYON_MIN_RATIO_BPS = 11_000n;

/** Collateral ratio in basis points, rounded down. 15000 = 150%. */
export function collateralRatioBps(collateralSats: bigint, debtCents: bigint, priceCents: bigint): bigint {
  if (debtCents <= 0n) throw new Error('collateralRatioBps: debt must be positive');
  return (collateralSats * priceCents * BPS) / (debtCents * SATS_PER_BCH);
}

/** Same comparison as the covenant: is the ratio strictly below `ratioBps`? */
export function isBelowRatio(collateralSats: bigint, debtCents: bigint, priceCents: bigint, ratioBps: bigint): boolean {
  return collateralSats * priceCents * BPS < ratioBps * debtCents * SATS_PER_BCH;
}

/** Largest collateral whose ratio is still at or below `ratioBps` (the covenant's target check). */
export function maxCollateralAtRatio(debtCents: bigint, priceCents: bigint, ratioBps: bigint): bigint {
  return (ratioBps * debtCents * SATS_PER_BCH) / (priceCents * BPS);
}

/** Price (cents per BCH) at which the loan's ratio equals `ratioBps`. Rounded up. */
export function priceAtRatio(collateralSats: bigint, debtCents: bigint, ratioBps: bigint): bigint {
  const numerator = ratioBps * debtCents * SATS_PER_BCH;
  const denominator = collateralSats * BPS;
  return (numerator + denominator - 1n) / denominator;
}

/**
 * Paryon's own rule for "can this loan be liquidated?" (liquidate.cash:57-63):
 * debt > floor(collateral * 10 / 11) * price / 1e8.
 */
export function isLiquidatable(collateralSats: bigint, debtCents: bigint, priceCents: bigint): boolean {
  const maxBorrow = (((collateralSats * 10n) / 11n) * priceCents) / SATS_PER_BCH;
  return debtCents > maxBorrow;
}

/** Liquidation price in cents per BCH (debt / collateral x 1.1), rounded up. */
export function liquidationPriceCents(collateralSats: bigint, debtCents: bigint): bigint {
  return priceAtRatio(collateralSats, debtCents, PARYON_MIN_RATIO_BPS);
}
