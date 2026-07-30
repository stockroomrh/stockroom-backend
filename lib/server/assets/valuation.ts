/**
 * Deterministic treasury math — the values the AI CFO and policy engine
 * (Stages 4/5) depend on for real decisions. Never approximate here; every
 * function is a pure calculation over already-verified inputs (real chain
 * balances, real prices), so it's fully unit-testable without a live RPC.
 */

export function rawBalanceToDisplay(rawBalance: bigint, decimals: number): number {
  return Number(rawBalance) / 10 ** decimals;
}

/**
 * tokenValue = rawBalance (display units) × multiplier-adjusted price.
 * See docs/PRODUCT_BRIEF.md §10 — Robinhood Stock Tokens report a raw
 * balanceOf() that does NOT reflect corporate actions (splits/dividends);
 * the multiplier from asset_registry.current_multiplier corrects for that.
 * Do not apply the multiplier again if the price feed is already
 * multiplier-adjusted (Chainlink feeds are) — pass multiplier=1 in that case.
 */
export function positionValueUsd(displayBalance: number, priceUsd: number, multiplier = 1): number {
  return displayBalance * priceUsd * multiplier;
}

export function allocationBps(positionValueUsdAmount: number, totalValueUsd: number): number {
  if (totalValueUsd <= 0) return 0;
  return Math.round((positionValueUsdAmount / totalValueUsd) * 10_000);
}

export function totalNavUsd(positionValues: number[]): number {
  return positionValues.reduce((sum, value) => sum + value, 0);
}

export function reservePercentage(reserveValueUsd: number, totalValueUsd: number): number {
  if (totalValueUsd <= 0) return 0;
  return Math.round((reserveValueUsd / totalValueUsd) * 1000) / 10; // one decimal place
}

export function percentChange(current: number, previous: number): number {
  if (previous <= 0) return 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/**
 * Runway in months = liquid reserves / average monthly net burn.
 * Returns Infinity-safe 0 when there's no measurable burn (revenue covers
 * expenses) rather than a misleading huge number.
 */
export function runwayMonths(liquidReserveUsd: number, monthlyExpensesUsd: number, monthlyRevenueUsd: number): number {
  const netBurn = monthlyExpensesUsd - monthlyRevenueUsd;
  if (netBurn <= 0) return 0;
  return Math.round((liquidReserveUsd / netBurn) * 10) / 10;
}

/**
 * A price is stale if it's older than the feed's own heartbeat (per
 * docs/PRODUCT_BRIEF.md §11 — read each Chainlink feed's actual heartbeat
 * rather than using one universal threshold). Callers pass the feed's
 * configured heartbeat in seconds; this has no built-in default because a
 * wrong default is worse than forcing the caller to be explicit.
 */
export function isPriceStale(priceUpdatedAt: Date, heartbeatSeconds: number, now: Date = new Date()): boolean {
  const ageSeconds = (now.getTime() - priceUpdatedAt.getTime()) / 1000;
  return ageSeconds > heartbeatSeconds;
}

export function policyRulesPassing(rules: { passing: boolean }[]): { passing: number; total: number } {
  return { passing: rules.filter((rule) => rule.passing).length, total: rules.length };
}
