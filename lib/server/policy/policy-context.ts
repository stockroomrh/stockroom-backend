import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TreasuryAssetRule, TreasuryPolicy } from "@/lib/types";
import { getProjectPolicy, getTreasuryData } from "@/lib/server/db/queries";
import { activeChainId } from "@/lib/chain-config";
import type { AssetRuleInput } from "./policy-engine";

export type PolicyEvaluationContext = {
  policy: TreasuryPolicy;
  tradingPaused: boolean;
  totalValueUsd: number;
  reserveValueUsd: number;
  cryptoValueUsd: number;
  /** symbol (lowercase) -> current position value in USD */
  positionValueBySymbol: Map<string, number>;
  /** symbol (lowercase) -> current indexed price in USD */
  priceBySymbol: Map<string, number>;
};

/**
 * Assembles everything the policy engine needs to evaluate a recommendation
 * against the treasury's *current* state. Shared by report generation
 * (Stage 4) and quote re-validation (Stage 5) so both paths can never
 * silently diverge on how "current reserve" or "current allocation" is
 * computed — a policy-critical invariant.
 */
export async function buildPolicyEvaluationContext(supabase: SupabaseClient, projectId: string): Promise<PolicyEvaluationContext> {
  const policy = await getProjectPolicy(supabase, projectId);
  if (!policy) throw new Error("This project has no treasury policy configured yet.");

  const { data: policyRow, error: policyRowError } = await supabase
    .from("treasury_policies")
    .select("trading_paused")
    .eq("project_id", projectId)
    .maybeSingle();
  if (policyRowError) throw new Error(policyRowError.message);
  const tradingPaused = Boolean(policyRow?.trading_paused);

  const { positions } = await getTreasuryData(supabase, projectId, policy);

  const { data: snapshotRow, error: snapshotError } = await supabase
    .from("treasury_snapshots")
    .select("total_value_usd, reserve_value_usd")
    .eq("project_id", projectId)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (snapshotError) throw new Error(snapshotError.message);

  const positionValueBySymbol = new Map(positions.map((p) => [p.symbol.toLowerCase(), p.value]));
  const priceBySymbol = new Map(positions.map((p) => [p.symbol.toLowerCase(), p.price]));
  const cryptoValueUsd = positions.filter((p) => p.type === "Crypto").reduce((sum, p) => sum + p.value, 0);

  return {
    policy,
    tradingPaused,
    totalValueUsd: snapshotRow?.total_value_usd ?? 0,
    reserveValueUsd: snapshotRow?.reserve_value_usd ?? 0,
    cryptoValueUsd,
    positionValueBySymbol,
    priceBySymbol,
  };
}

/**
 * Resolves the current per-project approval rule for a symbol (two-step
 * lookup — see note in the original callers — PostgREST only supports
 * filtering an embedded relation via an explicit inner join).
 *
 * asset_registry has one row PER CHAIN per symbol (testnet + mainnet both
 * exist simultaneously) — every symbol has 2+ matches without a chain_id
 * filter, which made .maybeSingle() error out and silently return null here,
 * i.e. every asset looked "unapproved" to the policy engine regardless of
 * its real project_approved_assets setting. Must scope to the active chain.
 */
export async function resolveAssetRule(supabase: SupabaseClient, projectId: string, symbol: string): Promise<AssetRuleInput> {
  const { data: assetRow } = await supabase.from("asset_registry").select("id, asset_type").ilike("symbol", symbol).eq("chain_id", activeChainId).maybeSingle();
  if (!assetRow) return null;
  const { data: approvedRow } = await supabase
    .from("project_approved_assets")
    .select("approved, agent_may_recommend, max_allocation_bps, max_single_purchase_usd")
    .eq("project_id", projectId)
    .eq("asset_id", assetRow.id)
    .maybeSingle();
  if (!approvedRow) return null;
  return {
    approved: approvedRow.approved,
    agentMayRecommend: approvedRow.agent_may_recommend,
    maxAllocationBps: approvedRow.max_allocation_bps,
    maxSinglePurchaseUsd: approvedRow.max_single_purchase_usd,
    type: assetRow.asset_type as TreasuryAssetRule["type"],
  };
}
