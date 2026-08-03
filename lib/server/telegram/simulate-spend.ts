import { reservePercentage } from "@/lib/server/assets/valuation";

export type SpendSimulation = {
  amountUsd: number;
  before: { valueUsd: number; reservePct: number };
  after: { valueUsd: number; reservePct: number };
  targetPct: number;
  blocked: boolean;
  maxAffordableUsd: number;
};

/**
 * Simulates spending a fixed USD amount OUT of the treasury (an expense —
 * marketing, dev costs, anything leaving the treasury entirely, not a
 * swap between held assets). Both total value and reserve drop by the same
 * amount, since the simplifying assumption for an expense is that it's paid
 * from USDG reserve. Purely deterministic, same reserve-floor math the real
 * policy engine enforces — this never touches the database or proposes a
 * real recommendation, it's a read-only "what if" answer.
 */
export function simulateSpend(totalValueUsd: number, reserveValueUsd: number, minimumReserveBps: number, amountUsd: number): SpendSimulation {
  const targetPct = minimumReserveBps / 100;
  const r = minimumReserveBps / 10_000;

  const before = { valueUsd: totalValueUsd, reservePct: reservePercentage(reserveValueUsd, totalValueUsd) };
  const afterValue = totalValueUsd - amountUsd;
  const afterReserve = reserveValueUsd - amountUsd;
  const after = { valueUsd: afterValue, reservePct: reservePercentage(Math.max(0, afterReserve), Math.max(0, afterValue)) };

  const blocked = afterValue <= 0 || afterReserve / Math.max(afterValue, 1e-9) < r;

  // Largest x such that (reserveValueUsd - x) / (totalValueUsd - x) >= r
  const maxAffordableUsd = Math.max(0, (reserveValueUsd - r * totalValueUsd) / (1 - r));

  return { amountUsd, before, after, targetPct, blocked, maxAffordableUsd };
}
