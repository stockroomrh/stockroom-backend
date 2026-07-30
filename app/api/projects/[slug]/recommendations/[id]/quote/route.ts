import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { AuthError } from "@/lib/server/auth/session";
import { requireProjectRole } from "@/lib/server/auth/roles";
import { revalidateForQuote, QuoteValidationError } from "@/lib/server/trading/quote-validation";
import { getSwapQuote, isZeroXConfigured, ZeroXError } from "@/lib/server/trading/zero-x-client";
import { getUniswapSwapQuote, UniswapQuoteError } from "@/lib/server/trading/uniswap-client";
import { storeTradeQuote } from "@/lib/server/db/trading";
import { activeChainId } from "@/lib/chain-config";
import { checkRateLimit, RateLimitError } from "@/lib/server/rate-limit";

const STOCK_LIKE_TYPES = new Set(["Stock Token", "ETF Token"]);

// Requests a fresh, real 0x quote for an approved recommendation. The taker
// is always the project's own treasury wallet, resolved server-side from
// treasury_accounts — never a client-supplied address — and the caller's
// authenticated wallet must match it exactly, so only whoever actually
// controls the treasury key can even reach a quote. No trade executes here.
export async function POST(_request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { projectId, user } = await requireProjectRole(slug, "operator");
    // Requesting a quote is cheap to call but triggers real external API
    // calls (0x / onchain reads) — 15 per minute per operator is generous
    // for normal use (refreshing an expiring quote a few times) while still
    // stopping accidental or malicious hammering.
    checkRateLimit(`quote:${user.id}`, 15, 60);

    const service = getSupabaseServiceClient();
    if (!service) return NextResponse.json({ error: "Live mode is not configured yet." }, { status: 503 });

    const { data: recommendation, error: recError } = await service
      .from("recommendations")
      .select("id, project_id, action, asset_symbol, suggested_notional_usd, status, expires_at")
      .eq("id", id)
      .maybeSingle();
    if (recError) throw new Error(recError.message);
    if (!recommendation) return NextResponse.json({ error: "Recommendation not found." }, { status: 404 });
    if (recommendation.project_id !== projectId) return NextResponse.json({ error: "Recommendation does not belong to this project." }, { status: 403 });

    const { data: treasuryAccount, error: treasuryError } = await service.from("treasury_accounts").select("address").eq("project_id", projectId).maybeSingle();
    if (treasuryError) throw new Error(treasuryError.message);
    if (!treasuryAccount) return NextResponse.json({ error: "This project has no treasury address configured." }, { status: 503 });
    if (user.walletAddress.toLowerCase() !== treasuryAccount.address.toLowerCase()) {
      return NextResponse.json(
        { error: `Your connected wallet (${user.walletAddress}) is not the treasury wallet (${treasuryAccount.address}). Sign in with the treasury wallet to trade.` },
        { status: 403 },
      );
    }

    const { sellToken, buyToken, sellAmountBaseUnits } = await revalidateForQuote(service, recommendation, treasuryAccount.address as `0x${string}`);

    // 0x's swap API explicitly refuses to route Stock/ETF token trades
    // ("not authorized for trade due to legal restrictions") even though
    // real, actively-traded Uniswap V3 pools exist for them — go straight
    // to the pool for those; keep 0x for everything else (crypto/stablecoin
    // pairs), where it already works and gives a firm, provider-simulated
    // quote rather than a spot-price read.
    const isStockLikeTrade = STOCK_LIKE_TYPES.has(sellToken.assetType) || STOCK_LIKE_TYPES.has(buyToken.assetType);

    let quote: { buyAmount: string; minBuyAmount: string; allowanceTarget: string; transaction: { to: string; data: string; value: string; gas: string | null }; priceImpactBps: number | null; integratorFee: string | null };
    if (isStockLikeTrade) {
      const uniswapQuote = await getUniswapSwapQuote({
        sellToken: sellToken.address as `0x${string}`,
        buyToken: buyToken.address as `0x${string}`,
        sellAmount: sellAmountBaseUnits,
        sellDecimals: sellToken.decimals,
        buyDecimals: buyToken.decimals,
        recipient: treasuryAccount.address as `0x${string}`,
      });
      quote = { ...uniswapQuote, priceImpactBps: null, integratorFee: null };
    } else {
      if (!isZeroXConfigured()) return NextResponse.json({ error: "Trading is not configured yet (ZEROX_API_KEY is missing)." }, { status: 503 });
      quote = await getSwapQuote({
        chainId: activeChainId,
        sellToken: sellToken.address,
        buyToken: buyToken.address,
        sellAmount: sellAmountBaseUnits.toString(),
        taker: treasuryAccount.address,
      });
    }

    // 0x quotes are firm for a short window — refresh well before the
    // provider's own expiry so we never hand the operator something the
    // relayer will already reject.
    const expiresAt = new Date(Date.now() + 45_000);
    const stored = await storeTradeQuote(service, {
      recommendationId: id,
      sellTokenAddress: sellToken.address,
      buyTokenAddress: buyToken.address,
      sellAmount: sellAmountBaseUnits.toString(),
      buyAmount: quote.buyAmount,
      minBuyAmount: quote.minBuyAmount,
      allowanceTarget: quote.allowanceTarget,
      transactionTarget: quote.transaction.to,
      estimatedGas: quote.transaction.gas,
      priceImpactBps: quote.priceImpactBps,
      integratorFee: quote.integratorFee,
      expiresAt,
    });

    await service.from("recommendations").update({ status: "quote_requested" }).eq("id", id);
    await service.from("recommendation_events").insert({
      recommendation_id: id,
      event_type: "quote_requested",
      actor_profile_id: user.id,
      detail: { quote_id: stored.id, sell_amount: sellAmountBaseUnits.toString(), buy_amount: quote.buyAmount },
    });

    return NextResponse.json({
      quoteId: stored.id,
      recommendationId: id,
      sellTokenSymbol: sellToken.symbol,
      sellTokenAddress: sellToken.address,
      sellTokenDecimals: sellToken.decimals,
      buyTokenSymbol: buyToken.symbol,
      buyTokenAddress: buyToken.address,
      buyTokenDecimals: buyToken.decimals,
      sellAmount: sellAmountBaseUnits.toString(),
      buyAmount: quote.buyAmount,
      minBuyAmount: quote.minBuyAmount,
      allowanceTarget: quote.allowanceTarget,
      transactionTarget: quote.transaction.to,
      transactionData: quote.transaction.data,
      transactionValue: quote.transaction.value,
      estimatedGas: quote.transaction.gas,
      priceImpactBps: quote.priceImpactBps,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (cause) {
    if (cause instanceof AuthError) return NextResponse.json({ error: cause.message }, { status: 403 });
    if (cause instanceof RateLimitError) return NextResponse.json({ error: cause.message }, { status: 429, headers: { "Retry-After": String(cause.retryAfterSeconds) } });
    if (cause instanceof QuoteValidationError) return NextResponse.json({ error: cause.message }, { status: 422 });
    if (cause instanceof ZeroXError) return NextResponse.json({ error: cause.message }, { status: 502 });
    if (cause instanceof UniswapQuoteError) return NextResponse.json({ error: cause.message }, { status: 502 });
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Failed to request a quote." }, { status: 500 });
  }
}
