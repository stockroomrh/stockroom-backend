/**
 * Deterministic policy engine. The AI CFO (lib/server/ai/*) may propose a
 * recommendation, but it never decides whether that recommendation complies
 * with treasury policy — this module is the sole, independent authority on
 * that question, run again server-side before any quote/execution too.
 */

export type RecommendationAction = "BUY" | "SELL" | "HOLD" | "BUILD_RESERVES" | "REBALANCE";

export type PolicyCheck = { name: string; passed: boolean; reason: string };
export type PolicyEvaluation = { passed: boolean; checks: PolicyCheck[] };

export type AssetRuleInput = {
  approved: boolean;
  agentMayRecommend: boolean;
  maxAllocationBps: number;
  maxSinglePurchaseUsd: number;
  type: "Stablecoin" | "Crypto" | "Stock Token" | "ETF Token";
} | null;

export type PolicyEngineInput = {
  action: RecommendationAction;
  assetSymbol: string;
  amountUsd: number;
  expiresAt?: Date | null;
  now?: Date;
  tradingPaused: boolean;
  minimumReserveBps: number;
  maximumSingleAssetBps: number;
  maximumCryptoBps: number;
  maximumTradeBps: number;
  assetRule: AssetRuleInput;
  totalValueUsd: number;
  reserveValueUsd: number;
  currentAssetValueUsd: number;
  cryptoValueUsd: number;
};

const bpsOf = (part: number, whole: number) => (whole <= 0 ? 0 : Math.round((part / whole) * 10_000));

/**
 * BUY/REBALANCE spend the USDG reserve to acquire more of an asset;
 * SELL/BUILD_RESERVES do the reverse (convert an asset back into USDG).
 * HOLD moves nothing.
 */
function directionOf(action: RecommendationAction): "into_asset" | "into_reserve" | "none" {
  if (action === "BUY" || action === "REBALANCE") return "into_asset";
  if (action === "SELL" || action === "BUILD_RESERVES") return "into_reserve";
  return "none";
}

export function evaluateRecommendation(input: PolicyEngineInput): PolicyEvaluation {
  const now = input.now ?? new Date();
  const checks: PolicyCheck[] = [];
  const check = (name: string, passed: boolean, reason: string) => checks.push({ name, passed, reason });

  check("trading_not_paused", !input.tradingPaused, input.tradingPaused ? "Trading is currently paused for this treasury." : "Trading is active.");

  const expired = Boolean(input.expiresAt && now.getTime() > input.expiresAt.getTime());
  check("not_expired", !expired, expired ? "This recommendation has expired." : "Recommendation is within its validity window.");

  const direction = directionOf(input.action);

  if (direction === "none") {
    // HOLD: no financial movement, nothing further to validate.
    return { passed: checks.every((c) => c.passed), checks };
  }

  const rule = input.assetRule;
  check("asset_approved", Boolean(rule?.approved), rule?.approved ? `${input.assetSymbol} is an approved treasury asset.` : `${input.assetSymbol} is not an approved treasury asset.`);
  check(
    "agent_may_recommend",
    Boolean(rule?.approved && rule.agentMayRecommend),
    rule?.agentMayRecommend ? `The Agent is permitted to recommend ${input.assetSymbol}.` : `The Agent is not permitted to recommend ${input.assetSymbol}.`,
  );

  if (!rule || !rule.approved) {
    // Can't evaluate limits against a rule that doesn't exist — stop here, already failed above.
    return { passed: false, checks };
  }

  const withinSingleAssetLimit = rule.maxSinglePurchaseUsd <= 0 || input.amountUsd <= rule.maxSinglePurchaseUsd;
  check(
    "within_asset_limit",
    withinSingleAssetLimit,
    withinSingleAssetLimit
      ? `Amount is within the $${rule.maxSinglePurchaseUsd.toLocaleString()} single-purchase limit for ${input.assetSymbol}.`
      : `Amount exceeds the $${rule.maxSinglePurchaseUsd.toLocaleString()} single-purchase limit for ${input.assetSymbol}.`,
  );

  if (direction === "into_asset") {
    // The global per-trade cap only gates trades that take on new exposure —
    // a sell/reserve-build trade can't make the treasury worse off than it
    // already is, so capping it the same way would trap any ETH-funded
    // project (e.g. every Pons launch) below the cap with no way for the
    // Agent to ever propose rebuilding reserve on its own.
    const maxTradeUsd = (input.maximumTradeBps / 10_000) * input.totalValueUsd;
    const withinGlobalTradeLimit = input.amountUsd <= maxTradeUsd;
    check(
      "within_global_trade_limit",
      withinGlobalTradeLimit,
      withinGlobalTradeLimit
        ? `Amount is within the global per-trade limit ($${maxTradeUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}).`
        : `Amount exceeds the global per-trade limit ($${maxTradeUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}, ${input.maximumTradeBps / 100}% of NAV).`,
    );

    const projectedAssetValue = input.currentAssetValueUsd + input.amountUsd;
    const projectedAllocationBps = bpsOf(projectedAssetValue, input.totalValueUsd);
    const withinAllocationLimit = projectedAllocationBps <= rule.maxAllocationBps;
    check(
      "within_allocation_limit",
      withinAllocationLimit,
      withinAllocationLimit
        ? `Resulting allocation (${(projectedAllocationBps / 100).toFixed(1)}%) stays within the ${rule.maxAllocationBps / 100}% limit for ${input.assetSymbol}.`
        : `Resulting allocation (${(projectedAllocationBps / 100).toFixed(1)}%) would exceed the ${rule.maxAllocationBps / 100}% limit for ${input.assetSymbol}.`,
    );

    const projectedReserveUsd = input.reserveValueUsd - input.amountUsd;
    const projectedReserveBps = bpsOf(projectedReserveUsd, input.totalValueUsd);
    const meetsReserveFloor = projectedReserveBps >= input.minimumReserveBps;
    check(
      "reserve_floor_maintained",
      meetsReserveFloor,
      meetsReserveFloor
        ? `USDG reserve stays at or above the ${input.minimumReserveBps / 100}% minimum after this trade.`
        : `This trade would reduce the USDG reserve below the ${input.minimumReserveBps / 100}% minimum.`,
    );

    if (rule.type === "Crypto") {
      const projectedCryptoUsd = input.cryptoValueUsd + input.amountUsd;
      const projectedCryptoBps = bpsOf(projectedCryptoUsd, input.totalValueUsd);
      const withinCryptoLimit = projectedCryptoBps <= input.maximumCryptoBps;
      check(
        "within_crypto_exposure_limit",
        withinCryptoLimit,
        withinCryptoLimit
          ? `Total crypto exposure (${(projectedCryptoBps / 100).toFixed(1)}%) stays within the ${input.maximumCryptoBps / 100}% limit.`
          : `Total crypto exposure (${(projectedCryptoBps / 100).toFixed(1)}%) would exceed the ${input.maximumCryptoBps / 100}% limit.`,
      );
    }
  }
  // direction === "into_reserve": selling into USDG only improves the reserve
  // ratio and reduces any single-asset/crypto exposure, so those checks are
  // not re-applied — the approval/limit checks above already gate the sell.

  return { passed: checks.every((c) => c.passed), checks };
}
