import type { TreasuryAssetRule } from "./types";

// Symbols match Robinhood's own tokenized-stock naming exactly (no "x"
// suffix, e.g. "NVDA" not "NVDAx") — verified against the real, Robinhood-
// issued contracts on Blockscout (each one's onchain name carries a
// "• Robinhood Token" marker distinguishing it from the many copycat/scam
// tokens squatting the same ticker symbol).
export const TREASURY_ASSET_CATALOG: Omit<TreasuryAssetRule, "approved" | "maxAllocation" | "maxSinglePurchaseUsd" | "agentMayRecommend" | "automaticExecution">[] = [
  { symbol: "USDG", name: "Global Dollar", type: "Stablecoin" },
  { symbol: "ETH", name: "Ether", type: "Crypto" },
  { symbol: "WETH", name: "Wrapped Ether", type: "Crypto" },
  { symbol: "NVDA", name: "NVIDIA", type: "Stock Token" },
  { symbol: "AAPL", name: "Apple", type: "Stock Token" },
  { symbol: "TSLA", name: "Tesla", type: "Stock Token" },
  { symbol: "AMZN", name: "Amazon", type: "Stock Token" },
  { symbol: "MSFT", name: "Microsoft", type: "Stock Token" },
  { symbol: "GOOGL", name: "Alphabet Class A", type: "Stock Token" },
  { symbol: "META", name: "Meta Platforms", type: "Stock Token" },
  { symbol: "MSTR", name: "Strategy Inc.", type: "Stock Token" },
  { symbol: "QCOM", name: "Qualcomm", type: "Stock Token" },
  { symbol: "NFLX", name: "Netflix", type: "Stock Token" },
  { symbol: "PLTR", name: "Palantir Technologies", type: "Stock Token" },
  { symbol: "AMD", name: "AMD", type: "Stock Token" },
  { symbol: "COIN", name: "Coinbase", type: "Stock Token" },
  { symbol: "SPCX", name: "Space Exploration Technologies Corp", type: "Stock Token" },
  { symbol: "CRCL", name: "Circle Internet Group", type: "Stock Token" },
  { symbol: "SPY", name: "SPDR S&P 500 ETF Trust", type: "ETF Token" },
];

export function createAssetRules(
  approvedSymbols: string[] = ["USDG", "ETH", "NVDA", "AAPL", "SPY"],
  maximumSingleAsset = 20,
): TreasuryAssetRule[] {
  const approved = new Set(approvedSymbols);
  return TREASURY_ASSET_CATALOG.map((asset) => {
    const isReserve = asset.symbol === "USDG";
    const isApproved = isReserve || approved.has(asset.symbol);
    return {
      ...asset,
      approved: isApproved,
      maxAllocation: isReserve ? 100 : maximumSingleAsset,
      maxSinglePurchaseUsd: isReserve ? 100_000 : 2_500,
      agentMayRecommend: isApproved && !isReserve,
      automaticExecution: false,
    };
  });
}

export function approvedAssetSymbols(rules: TreasuryAssetRule[]) {
  return rules.filter((rule) => rule.approved).map((rule) => rule.symbol);
}
