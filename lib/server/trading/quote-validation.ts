import "server-only";
import type { Address } from "viem";
import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateRecommendation, type PolicyEvaluation, type RecommendationAction } from "@/lib/server/policy/policy-engine";
import { buildPolicyEvaluationContext, resolveAssetRule } from "@/lib/server/policy/policy-context";
import { activeChainId, NATIVE_ETH_SENTINEL } from "@/lib/chain-config";
import { getChainClient } from "@/lib/server/chain/client";

export class QuoteValidationError extends Error {}

export type TokenInfo = { symbol: string; address: string; decimals: number; assetType: string };

type RecommendationRecord = {
  id: string;
  project_id: string;
  action: string;
  asset_symbol: string | null;
  suggested_notional_usd: number | null;
  status: string;
  expires_at: string | null;
};

/**
 * Only a real, verified contract address from asset_registry is trusted —
 * never a "pending:*" placeholder seeded before an asset's canonical
 * address was known (see the same guard in treasury-sync.ts).
 *
 * asset_registry has one row per symbol PER CHAIN (testnet + mainnet both
 * exist) — same chain-scoping bug as resolveAssetRule in policy-context.ts:
 * without a chain_id filter, .maybeSingle() errors on the 2+ matches and
 * silently returns null, making every asset look unconfigured regardless of
 * its real contract_address.
 */
export async function resolveTokenInfo(supabase: SupabaseClient, symbol: string): Promise<TokenInfo | null> {
  const { data } = await supabase.from("asset_registry").select("symbol, contract_address, decimals, asset_type").ilike("symbol", symbol).eq("chain_id", activeChainId).maybeSingle();
  if (!data || !data.contract_address || data.contract_address.startsWith("pending:")) return null;
  return { symbol: data.symbol, address: data.contract_address, decimals: data.decimals, assetType: data.asset_type };
}

function usdToBaseUnits(amountUsd: number, decimals: number): bigint {
  // Round at 6 decimal places of USD precision before scaling to avoid
  // floating point drift — comfortably more precision than a USD notional
  // input needs.
  const scaled = Math.round(amountUsd * 1_000_000);
  return (BigInt(scaled) * 10n ** BigInt(decimals)) / 1_000_000n;
}

export type QuoteValidationResult = {
  evaluation: PolicyEvaluation;
  sellToken: TokenInfo;
  buyToken: TokenInfo;
  sellAmountBaseUnits: bigint;
};

/**
 * Re-runs the full deterministic policy check against *current* treasury
 * state — the check stored on the recommendation at generation time is
 * never trusted for this, since prices and balances may have moved since.
 * Also resolves the real, verified token addresses/decimals needed to
 * request an onchain quote. Throws QuoteValidationError (never silently
 * degrades) on any failure — including a failing policy re-check.
 */
export async function revalidateForQuote(supabase: SupabaseClient, recommendation: RecommendationRecord, treasuryAddress: Address): Promise<QuoteValidationResult> {
  if (recommendation.action === "HOLD") throw new QuoteValidationError("A HOLD recommendation has nothing to quote.");
  if (!recommendation.asset_symbol) throw new QuoteValidationError("This recommendation has no target asset.");
  if (!["approved", "quote_requested"].includes(recommendation.status)) {
    throw new QuoteValidationError(`This recommendation is "${recommendation.status}" and cannot be quoted — it must be approved by an operator first.`);
  }

  const context = await buildPolicyEvaluationContext(supabase, recommendation.project_id);
  const assetRule = await resolveAssetRule(supabase, recommendation.project_id, recommendation.asset_symbol);
  const amountUsd = recommendation.suggested_notional_usd ?? 0;
  const currentAssetValueUsd = context.positionValueBySymbol.get(recommendation.asset_symbol.toLowerCase()) ?? 0;

  const evaluation = evaluateRecommendation({
    action: recommendation.action as RecommendationAction,
    assetSymbol: recommendation.asset_symbol,
    amountUsd,
    tradingPaused: context.tradingPaused,
    minimumReserveBps: Math.round(context.policy.minimumReserve * 100),
    maximumSingleAssetBps: Math.round(context.policy.maximumSingleAsset * 100),
    maximumCryptoBps: Math.round(context.policy.maximumCrypto * 100),
    maximumTradeBps: Math.round(context.policy.maximumTrade * 100),
    assetRule,
    totalValueUsd: context.totalValueUsd,
    reserveValueUsd: context.reserveValueUsd,
    currentAssetValueUsd,
    cryptoValueUsd: context.cryptoValueUsd,
    expiresAt: recommendation.expires_at ? new Date(recommendation.expires_at) : null,
  });

  if (!evaluation.passed) {
    const failedCheck = evaluation.checks.find((check) => !check.passed);
    throw new QuoteValidationError(`Policy re-validation failed: ${failedCheck?.reason ?? "current treasury state no longer satisfies policy."}`);
  }

  const isIntoAsset = recommendation.action === "BUY" || recommendation.action === "REBALANCE";
  const sellSymbol = isIntoAsset ? "USDG" : recommendation.asset_symbol;
  const buySymbol = isIntoAsset ? recommendation.asset_symbol : "USDG";

  const [sellToken, buyToken] = await Promise.all([resolveTokenInfo(supabase, sellSymbol), resolveTokenInfo(supabase, buySymbol)]);
  if (!sellToken) throw new QuoteValidationError(`${sellSymbol} does not have a verified onchain contract address yet.`);
  if (!buyToken) throw new QuoteValidationError(`${buySymbol} does not have a verified onchain contract address yet.`);

  let sellAmountBaseUnits: bigint;
  if (isIntoAsset) {
    // Selling USDG — a $1 stablecoin — converts 1:1.
    sellAmountBaseUnits = usdToBaseUnits(amountUsd, sellToken.decimals);
  } else {
    // Selling the asset itself: convert the USD notional to the asset's
    // base units using its current indexed price.
    const priceUsd = context.priceBySymbol.get(recommendation.asset_symbol.toLowerCase()) ?? 0;
    if (priceUsd <= 0) throw new QuoteValidationError(`${recommendation.asset_symbol} has no current indexed price — cannot size this trade.`);
    sellAmountBaseUnits = usdToBaseUnits(amountUsd / priceUsd, sellToken.decimals);
  }
  if (sellAmountBaseUnits <= 0n) throw new QuoteValidationError("Computed sell amount is zero.");

  // Selling native ETH itself must never spend the full wallet balance —
  // unlike an ERC-20, there's no separate gas token to fall back on, so a
  // "sell everything" trade would leave nothing to pay for the swap
  // transaction itself. A recommendation's suggested notional is also
  // computed from a snapshot that can be a few seconds stale relative to
  // the real balance by the time this runs. Clamp to (balance - a real,
  // current gas estimate with a safety margin) rather than trusting the
  // recommendation amount outright.
  if (sellToken.address.toLowerCase() === NATIVE_ETH_SENTINEL.toLowerCase()) {
    const client = getChainClient();
    if (!client) throw new QuoteValidationError("Chain RPC is not configured — cannot safely size a native ETH sell.");
    const [balance, gasPrice] = await Promise.all([client.getBalance({ address: treasuryAddress }), client.getGasPrice()]);
    const gasReserve = 500_000n * gasPrice * 3n; // ~500k gas at 3x current price, comfortably covers estimation drift
    const maxSellable = balance > gasReserve ? balance - gasReserve : 0n;
    if (maxSellable <= 0n) {
      throw new QuoteValidationError("The treasury's ETH balance is too low to sell any of it right now — nothing would be left to pay for the transaction's own gas.");
    }
    if (sellAmountBaseUnits > maxSellable) sellAmountBaseUnits = maxSellable;
  }

  return { evaluation, sellToken, buyToken, sellAmountBaseUnits };
}
