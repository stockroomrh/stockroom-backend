import "server-only";
import type { Address } from "viem";
import { getChainClient } from "@/lib/server/chain/client";

const AGGREGATOR_V3_ABI = [
  { type: "function", name: "latestRoundData", stateMutability: "view", inputs: [], outputs: [
    { name: "roundId", type: "uint80" }, { name: "answer", type: "int256" }, { name: "startedAt", type: "uint256" },
    { name: "updatedAt", type: "uint256" }, { name: "answeredInRound", type: "uint80" },
  ] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
] as const;

export type FeedPrice = { priceUsd: number; updatedAt: Date };

/**
 * Reads a Chainlink-compatible price feed. Per docs/PRODUCT_BRIEF.md §10-11,
 * Robinhood Stock Token feeds already return the multiplier-adjusted USD
 * value of one token — callers must not apply asset_registry.current_multiplier
 * again on top of this.
 */
export async function readPriceFeed(feedAddress: Address): Promise<FeedPrice | null> {
  const client = getChainClient();
  if (!client) return null;

  const [roundData, feedDecimals] = await Promise.all([
    client.readContract({ address: feedAddress, abi: AGGREGATOR_V3_ABI, functionName: "latestRoundData" }),
    client.readContract({ address: feedAddress, abi: AGGREGATOR_V3_ABI, functionName: "decimals" }),
  ]);

  const [, answer, , updatedAt] = roundData;
  return {
    priceUsd: Number(answer) / 10 ** feedDecimals,
    updatedAt: new Date(Number(updatedAt) * 1000),
  };
}

/** USDG is a USD-pegged stablecoin; treat it as a fixed $1 peg rather than requiring a feed for it specifically. */
export function isStablePegAsset(symbol: string) {
  return symbol.toUpperCase() === "USDG";
}

/**
 * Display-only ETH/USD price from a public market data API — used only when
 * no onchain Chainlink feed is configured for native ETH yet. Per
 * docs/PRODUCT_BRIEF.md §11's onchain-vs-offchain distinction, this is fine
 * for dashboard display but must never be used for policy-critical decisions
 * (trade sizing, reserve checks) — those require the onchain feed.
 */
export async function getEthDisplayPriceUsd(): Promise<{ priceUsd: number; updatedAt: Date } | null> {
  // Two attempts, same as the AI report generation retry pattern — CoinGecko's
  // public API intermittently 403s/rate-limits requests without a browser-like
  // User-Agent, especially from datacenter IPs (e.g. Vercel), which previously
  // caused WETH's price — and therefore its contribution to the treasury
  // total — to silently drop to $0 on any single flaky call.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd", {
        cache: "no-store",
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      if (!response.ok) continue;
      const body = (await response.json()) as { ethereum?: { usd?: number } };
      if (typeof body.ethereum?.usd !== "number") continue;
      return { priceUsd: body.ethereum.usd, updatedAt: new Date() };
    } catch {
      // fall through and retry once before giving up
    }
  }
  return null;
}

/**
 * Display-only underlying-equity price for a Stock Token, from a free public
 * quote source — used only when no onchain Chainlink feed is configured for
 * that ticker yet. Same onchain-vs-offchain distinction as getEthDisplayPriceUsd:
 * fine for dashboard display, never for policy-critical decisions. Note this
 * is the raw underlying price, NOT multiplier-adjusted — callers apply
 * asset_registry.current_multiplier themselves, same as the REST path
 * described in docs/PRODUCT_BRIEF.md §11.
 */
export async function getStockDisplayPriceUsd(symbol: string): Promise<{ priceUsd: number; updatedAt: Date } | null> {
  try {
    const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`, {
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { chart?: { result?: { meta?: { regularMarketPrice?: number } }[] } };
    const price = body.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (typeof price !== "number") return null;
    return { priceUsd: price, updatedAt: new Date() };
  } catch {
    return null;
  }
}

/**
 * Display-only price for a token traded on an onchain DEX (e.g. a project's
 * own governance/utility token with no Chainlink feed), sourced from
 * DexScreener's public API. Same onchain-vs-offchain distinction as the
 * other display-price helpers here: fine for dashboard display, never for
 * policy-critical decisions — DexScreener is a public aggregator, not an
 * oracle, and can be wrong or delayed.
 */
export async function getDexScreenerPriceUsd(contractAddress: string): Promise<{ priceUsd: number; updatedAt: Date } | null> {
  try {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`, { cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as { pairs?: { priceUsd?: string; liquidity?: { usd?: number } }[] };
    if (!body.pairs || body.pairs.length === 0) return null;
    // Prefer the pair with the deepest liquidity — the most reliable price when a token has several pools.
    const best = body.pairs.reduce((a, b) => ((b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a));
    const price = best.priceUsd ? Number(best.priceUsd) : NaN;
    if (!Number.isFinite(price) || price <= 0) return null;
    return { priceUsd: price, updatedAt: new Date() };
  } catch {
    return null;
  }
}
