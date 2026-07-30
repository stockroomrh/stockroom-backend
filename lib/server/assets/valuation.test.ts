import { describe, expect, it } from "vitest";
import {
  allocationBps,
  isPriceStale,
  percentChange,
  policyRulesPassing,
  positionValueUsd,
  rawBalanceToDisplay,
  reservePercentage,
  runwayMonths,
  totalNavUsd,
} from "./valuation";

describe("rawBalanceToDisplay", () => {
  it("converts raw base units to display units using decimals", () => {
    expect(rawBalanceToDisplay(1_000_000_000_000_000_000n, 18)).toBe(1);
    expect(rawBalanceToDisplay(500_000n, 6)).toBe(0.5);
    expect(rawBalanceToDisplay(0n, 18)).toBe(0);
  });
});

describe("positionValueUsd", () => {
  it("multiplies display balance by price", () => {
    expect(positionValueUsd(100, 1)).toBe(100);
    expect(positionValueUsd(2.5, 200)).toBe(500);
  });

  it("applies the corporate-action multiplier when provided", () => {
    // e.g. a 2:1 stock split reflected via uiMultiplier per docs/PRODUCT_BRIEF.md §10
    expect(positionValueUsd(10, 50, 2)).toBe(1000);
  });

  it("defaults multiplier to 1 (no double-adjustment for already-adjusted feeds)", () => {
    expect(positionValueUsd(10, 50)).toBe(500);
  });
});

describe("allocationBps", () => {
  it("computes basis points of total", () => {
    expect(allocationBps(2000, 10_000)).toBe(2000); // 20% = 2000 bps
    expect(allocationBps(6000, 10_000)).toBe(6000);
  });

  it("returns 0 when total is zero or negative rather than dividing by zero", () => {
    expect(allocationBps(500, 0)).toBe(0);
    expect(allocationBps(500, -10)).toBe(0);
  });
});

describe("totalNavUsd", () => {
  it("sums position values", () => {
    expect(totalNavUsd([100, 200, 300.5])).toBe(600.5);
    expect(totalNavUsd([])).toBe(0);
  });
});

describe("reservePercentage", () => {
  it("computes reserve share to one decimal place", () => {
    expect(reservePercentage(6000, 10_000)).toBe(60);
    expect(reservePercentage(3333, 10_000)).toBe(33.3);
  });

  it("returns 0 for zero total", () => {
    expect(reservePercentage(100, 0)).toBe(0);
  });
});

describe("percentChange", () => {
  it("computes percent change to one decimal place", () => {
    expect(percentChange(110, 100)).toBe(10);
    expect(percentChange(90, 100)).toBe(-10);
  });

  it("returns 0 when there's no valid baseline", () => {
    expect(percentChange(100, 0)).toBe(0);
  });
});

describe("runwayMonths", () => {
  it("computes months of runway from net burn", () => {
    expect(runwayMonths(12_000, 2000, 0)).toBe(6);
  });

  it("nets revenue against expenses before computing burn", () => {
    expect(runwayMonths(10_000, 3000, 1000)).toBe(5); // net burn = 2000/mo
  });

  it("returns 0 when revenue covers or exceeds expenses (no burn)", () => {
    expect(runwayMonths(10_000, 1000, 1000)).toBe(0);
    expect(runwayMonths(10_000, 1000, 5000)).toBe(0);
  });
});

describe("isPriceStale", () => {
  it("flags a price older than the feed's heartbeat", () => {
    const updatedAt = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-01-01T01:00:00Z"); // 1 hour later
    expect(isPriceStale(updatedAt, 1800, now)).toBe(true); // 30 min heartbeat
    expect(isPriceStale(updatedAt, 7200, now)).toBe(false); // 2 hour heartbeat
  });
});

describe("policyRulesPassing", () => {
  it("counts passing rules against the total", () => {
    expect(policyRulesPassing([{ passing: true }, { passing: false }, { passing: true }])).toEqual({ passing: 2, total: 3 });
    expect(policyRulesPassing([])).toEqual({ passing: 0, total: 0 });
  });
});
