import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type TradeQuoteRow = {
  id: string;
  recommendation_id: string;
  sell_token: string;
  buy_token: string;
  sell_amount: string;
  expected_buy_amount: string;
  minimum_buy_amount: string;
  allowance_target: string;
  transaction_target: string;
  expires_at: string;
};

/**
 * Stores quote metadata for audit only — never the raw swap calldata.
 * Calldata isn't secret (it's public the moment it's broadcast), but it's
 * also never needed again after the operator signs: the frontend already
 * holds the full quote response returned by the /quote route for the ~45s
 * it takes to sign, and nothing server-side re-reads it afterward.
 */
export async function storeTradeQuote(
  supabase: SupabaseClient,
  input: {
    recommendationId: string;
    sellTokenAddress: string;
    buyTokenAddress: string;
    sellAmount: string;
    buyAmount: string;
    minBuyAmount: string;
    allowanceTarget: string;
    transactionTarget: string;
    estimatedGas: string | null;
    priceImpactBps: number | null;
    integratorFee: string | null;
    expiresAt: Date;
  },
): Promise<{ id: string; expiresAt: string }> {
  const { data, error } = await supabase
    .from("trade_quotes")
    .insert({
      recommendation_id: input.recommendationId,
      provider: "0x",
      sell_token: input.sellTokenAddress,
      buy_token: input.buyTokenAddress,
      sell_amount: input.sellAmount,
      expected_buy_amount: input.buyAmount,
      minimum_buy_amount: input.minBuyAmount,
      estimated_gas: input.estimatedGas,
      integrator_fee: input.integratorFee,
      allowance_target: input.allowanceTarget,
      transaction_target: input.transactionTarget,
      price_impact_bps: input.priceImpactBps,
      expires_at: input.expiresAt.toISOString(),
    })
    .select("id, expires_at")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to store the trade quote.");
  return { id: data.id as string, expiresAt: data.expires_at as string };
}

export async function getTradeQuote(supabase: SupabaseClient, quoteId: string): Promise<TradeQuoteRow | null> {
  const { data, error } = await supabase
    .from("trade_quotes")
    .select("id, recommendation_id, sell_token, buy_token, sell_amount, expected_buy_amount, minimum_buy_amount, allowance_target, transaction_target, expires_at")
    .eq("id", quoteId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as TradeQuoteRow | null) ?? null;
}

export type TradeExecutionRow = {
  id: string;
  quote_id: string;
  recommendation_id: string;
  operator_address: string;
  approval_tx_hash: string | null;
  swap_tx_hash: string;
  status: "pending" | "submitted" | "confirmed" | "failed";
  failure_reason: string | null;
};

export async function createTradeExecution(
  supabase: SupabaseClient,
  input: { quoteId: string; recommendationId: string; operatorAddress: string; swapTxHash: string; approvalTxHash: string | null },
): Promise<{ id: string; status: string }> {
  const { data, error } = await supabase
    .from("trade_executions")
    .insert({
      quote_id: input.quoteId,
      recommendation_id: input.recommendationId,
      operator_address: input.operatorAddress,
      approval_tx_hash: input.approvalTxHash,
      swap_tx_hash: input.swapTxHash,
      status: "submitted",
      submitted_at: new Date().toISOString(),
    })
    .select("id, status")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to record the trade execution.");
  return { id: data.id as string, status: data.status as string };
}

export async function getTradeExecution(supabase: SupabaseClient, executionId: string): Promise<TradeExecutionRow | null> {
  const { data, error } = await supabase
    .from("trade_executions")
    .select("id, quote_id, recommendation_id, operator_address, approval_tx_hash, swap_tx_hash, status, failure_reason")
    .eq("id", executionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as TradeExecutionRow | null) ?? null;
}

export async function finalizeTradeExecution(
  supabase: SupabaseClient,
  executionId: string,
  status: "confirmed" | "failed",
  failureReason: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("trade_executions")
    .update({ status, failure_reason: failureReason, confirmed_at: status === "confirmed" ? new Date().toISOString() : null })
    .eq("id", executionId);
  if (error) throw new Error(error.message);
}
