import { describe, expect, it } from "vitest";
import { evaluateRecommendation, type PolicyEngineInput } from "./policy-engine";

const baseInput: PolicyEngineInput = {
  action: "BUY",
  assetSymbol: "TSLA",
  amountUsd: 1000,
  tradingPaused: false,
  minimumReserveBps: 6000, // 60%
  maximumSingleAssetBps: 2000, // 20%
  maximumCryptoBps: 1500, // 15%
  maximumTradeBps: 1000, // 10%
  assetRule: { approved: true, agentMayRecommend: true, maxAllocationBps: 2000, maxSinglePurchaseUsd: 2500, type: "Stock Token" },
  totalValueUsd: 38_000,
  reserveValueUsd: 24_000, // ~63%
  currentAssetValueUsd: 2000,
  cryptoValueUsd: 0,
};

describe("evaluateRecommendation", () => {
  it("passes a well-formed, within-limits BUY", () => {
    const result = evaluateRecommendation(baseInput);
    expect(result.passed).toBe(true);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it("blocks trading when paused, regardless of everything else", () => {
    const result = evaluateRecommendation({ ...baseInput, tradingPaused: true });
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.name === "trading_not_paused")?.passed).toBe(false);
  });

  it("blocks an expired recommendation", () => {
    const result = evaluateRecommendation({ ...baseInput, expiresAt: new Date("2020-01-01"), now: new Date("2026-01-01") });
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.name === "not_expired")?.passed).toBe(false);
  });

  it("always passes HOLD regardless of asset rules", () => {
    const result = evaluateRecommendation({ ...baseInput, action: "HOLD", assetRule: null });
    expect(result.passed).toBe(true);
  });

  it("blocks an unapproved asset", () => {
    const result = evaluateRecommendation({ ...baseInput, assetRule: null });
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.name === "asset_approved")?.passed).toBe(false);
  });

  it("blocks when the asset is approved but the Agent may not recommend it", () => {
    const result = evaluateRecommendation({ ...baseInput, assetRule: { ...baseInput.assetRule!, agentMayRecommend: false } });
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.name === "agent_may_recommend")?.passed).toBe(false);
  });

  it("blocks an amount over the asset's single-purchase limit", () => {
    const result = evaluateRecommendation({ ...baseInput, amountUsd: 5000 }); // limit is 2500
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.name === "within_asset_limit")?.passed).toBe(false);
  });

  it("blocks an amount over the global per-trade limit", () => {
    // 10% of 38,000 = 3,800; ask for more than that but under the asset's own $2,500 cap by raising it
    const result = evaluateRecommendation({
      ...baseInput,
      amountUsd: 4000,
      assetRule: { ...baseInput.assetRule!, maxSinglePurchaseUsd: 10_000 },
    });
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.name === "within_global_trade_limit")?.passed).toBe(false);
  });

  it("blocks a trade that would push allocation over the asset's max allocation", () => {
    // current 2000 + 1000 = 3000 of 38000 = ~7.9%, fine at 20% cap — push it over instead
    const result = evaluateRecommendation({ ...baseInput, currentAssetValueUsd: 6600, amountUsd: 1000 }); // (6600+1000)/38000 = 20.0%+
    expect(result.checks.find((c) => c.name === "within_allocation_limit")).toBeDefined();
  });

  it("blocks a trade that would drop the USDG reserve below the minimum", () => {
    // reserve at 24000/38000 = 63.2%; spending 1500 drops it to 22500/38000 = 59.2%, below the 60% floor
    const result = evaluateRecommendation({ ...baseInput, amountUsd: 1500, assetRule: { ...baseInput.assetRule!, maxSinglePurchaseUsd: 10_000 }, maximumTradeBps: 10_000 });
    const reserveCheck = result.checks.find((c) => c.name === "reserve_floor_maintained");
    expect(reserveCheck?.passed).toBe(false);
  });

  it("allows a trade that keeps the USDG reserve at or above the minimum", () => {
    // reserve at 24000/38000 = 63.2%; spending 800 drops it to 23200/38000 = 61.05%, still above 60%
    const result = evaluateRecommendation({ ...baseInput, amountUsd: 800, assetRule: { ...baseInput.assetRule!, maxSinglePurchaseUsd: 10_000 }, maximumTradeBps: 10_000 });
    const reserveCheck = result.checks.find((c) => c.name === "reserve_floor_maintained");
    expect(reserveCheck?.passed).toBe(true);
  });

  it("computes the reserve floor breach correctly", () => {
    const result = evaluateRecommendation({
      ...baseInput,
      amountUsd: 2000,
      assetRule: { ...baseInput.assetRule!, maxSinglePurchaseUsd: 10_000 },
      maximumTradeBps: 10_000,
      maximumSingleAssetBps: 10_000,
      reserveValueUsd: 22_800, // 60% exactly of 38000
    });
    // spending 2000 from a reserve that's exactly at the 60% floor must fail
    expect(result.checks.find((c) => c.name === "reserve_floor_maintained")?.passed).toBe(false);
  });

  it("applies the crypto exposure check only to Crypto-type assets", () => {
    const cryptoInput: PolicyEngineInput = {
      ...baseInput,
      assetSymbol: "ETH",
      amountUsd: 3000,
      assetRule: { approved: true, agentMayRecommend: true, maxAllocationBps: 10_000, maxSinglePurchaseUsd: 10_000, type: "Crypto" },
      maximumTradeBps: 10_000,
      cryptoValueUsd: 4000, // (4000+3000)/38000 = 18.4% > 15% cap
    };
    const result = evaluateRecommendation(cryptoInput);
    expect(result.checks.find((c) => c.name === "within_crypto_exposure_limit")?.passed).toBe(false);
  });

  it("does not apply the crypto exposure check to non-Crypto assets", () => {
    const result = evaluateRecommendation(baseInput); // Stock Token
    expect(result.checks.find((c) => c.name === "within_crypto_exposure_limit")).toBeUndefined();
  });

  it("does not re-apply reserve/allocation/crypto checks to a SELL (into_reserve direction)", () => {
    const result = evaluateRecommendation({ ...baseInput, action: "SELL" });
    expect(result.checks.find((c) => c.name === "reserve_floor_maintained")).toBeUndefined();
    expect(result.checks.find((c) => c.name === "within_allocation_limit")).toBeUndefined();
    expect(result.passed).toBe(true);
  });

  it("treats BUILD_RESERVES as an into_reserve action", () => {
    const result = evaluateRecommendation({ ...baseInput, action: "BUILD_RESERVES" });
    expect(result.checks.find((c) => c.name === "reserve_floor_maintained")).toBeUndefined();
  });

  it("does not apply the global per-trade cap to a SELL, even one that exceeds it", () => {
    // 10% of 38,000 = 3,800 — this SELL is well over that, and must still pass:
    // reducing an existing position can't make the treasury worse off, so the
    // cap meant to limit new-exposure trades shouldn't block it (otherwise an
    // ETH-funded treasury with 0% reserve could never recommend rebuilding it).
    const result = evaluateRecommendation({ ...baseInput, action: "SELL", amountUsd: 10_000, assetRule: { ...baseInput.assetRule!, maxSinglePurchaseUsd: 20_000 } });
    expect(result.checks.find((c) => c.name === "within_global_trade_limit")).toBeUndefined();
    expect(result.passed).toBe(true);
  });

  it("still applies the global per-trade cap to a BUY/REBALANCE (into_asset)", () => {
    const result = evaluateRecommendation({ ...baseInput, action: "BUY", amountUsd: 4000, assetRule: { ...baseInput.assetRule!, maxSinglePurchaseUsd: 10_000 } });
    expect(result.checks.find((c) => c.name === "within_global_trade_limit")?.passed).toBe(false);
  });

  it("treats REBALANCE as an into_asset action, subject to the same limits as BUY", () => {
    const result = evaluateRecommendation({ ...baseInput, action: "REBALANCE", amountUsd: 5000 });
    expect(result.checks.find((c) => c.name === "within_asset_limit")?.passed).toBe(false); // over the $2500 cap
  });
});
