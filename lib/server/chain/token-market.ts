import "server-only";
import { erc20Abi, type Address } from "viem";
import { getChainClient } from "@/lib/server/chain/client";
import { getErc20Balances } from "@/lib/server/chain/balances";
import { getEthDisplayPriceUsd } from "@/lib/server/assets/price-feeds";

const POOL_ABI = [
  {
    inputs: [],
    name: "slot0",
    outputs: [
      { internalType: "uint160", name: "sqrtPriceX96", type: "uint160" },
      { internalType: "int24", name: "tick", type: "int24" },
      { internalType: "uint16", name: "observationIndex", type: "uint16" },
      { internalType: "uint16", name: "observationCardinality", type: "uint16" },
      { internalType: "uint16", name: "observationCardinalityNext", type: "uint16" },
      { internalType: "uint8", name: "feeProtocol", type: "uint8" },
      { internalType: "bool", name: "unlocked", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  { inputs: [], name: "token0", outputs: [{ internalType: "address", name: "", type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "token1", outputs: [{ internalType: "address", name: "", type: "address" }], stateMutability: "view", type: "function" },
] as const;

export type TokenMarketData = { priceUsd: number; marketCapUsd: number; liquidityUsd: number; circulatingSupply: number };

/**
 * Reads a Pons-launched token's real market data directly from its Uniswap
 * V3 pool — Blockscout's own exchange_rate/circulating_market_cap fields
 * come back null for tokens it hasn't indexed a price for yet, so price has
 * to come from slot0() directly rather than depending on that indexer.
 * Liquidity is the actual USD value of both sides' balances held by the pool
 * address (not a symmetric TVL estimate) — Pons pools start single-sided
 * (100% project token, 0 pair token) and only accumulate the pair token as
 * real buys happen, so summing both real balances is exact, not an estimate.
 */
export async function getPonsTokenMarketData(params: {
  tokenAddress: Address;
  poolAddress: Address;
  treasuryAddress: Address;
  tokenDecimals: number;
  totalSupply: number;
}): Promise<TokenMarketData | null> {
  const client = getChainClient();
  if (!client) return null;

  try {
    const [slot0, token0, token1] = await Promise.all([
      client.readContract({ address: params.poolAddress, abi: POOL_ABI, functionName: "slot0" }),
      client.readContract({ address: params.poolAddress, abi: POOL_ABI, functionName: "token0" }),
      client.readContract({ address: params.poolAddress, abi: POOL_ABI, functionName: "token1" }),
    ]);

    const isToken0 = token0.toLowerCase() === params.tokenAddress.toLowerCase();
    const pairTokenAddress = (isToken0 ? token1 : token0) as Address;
    const pairDecimals = await client.readContract({ address: pairTokenAddress, abi: erc20Abi, functionName: "decimals" });

    const sqrtPriceX96 = slot0[0];
    const Q96 = 2 ** 96;
    const sqrtPrice = Number(sqrtPriceX96) / Q96;
    const rawRatioToken1PerToken0 = sqrtPrice ** 2;
    // Adjust the raw (integer-unit) ratio for each token's decimals to get a display-unit ratio.
    const decimals0 = isToken0 ? params.tokenDecimals : pairDecimals;
    const decimals1 = isToken0 ? pairDecimals : params.tokenDecimals;
    const displayRatioToken1PerToken0 = rawRatioToken1PerToken0 * 10 ** decimals0 / 10 ** decimals1;
    // Price of our token, denominated in the pair token.
    const pairPerOurToken = isToken0 ? displayRatioToken1PerToken0 : 1 / displayRatioToken1PerToken0;

    const ethPrice = await getEthDisplayPriceUsd();
    const pairUsd = ethPrice?.priceUsd ?? 0;
    const priceUsd = pairPerOurToken * pairUsd;

    const [treasuryBalances, poolBalances] = await Promise.all([
      getErc20Balances(params.treasuryAddress, [params.tokenAddress]),
      getErc20Balances(params.poolAddress, [params.tokenAddress, pairTokenAddress]),
    ]);

    const treasuryHeld = Number(treasuryBalances[0]?.rawBalance ?? 0n) / 10 ** params.tokenDecimals;
    const circulatingSupply = Math.max(0, params.totalSupply - treasuryHeld);

    const poolOurTokenBalance = Number((poolBalances.find((b) => b.address.toLowerCase() === params.tokenAddress.toLowerCase())?.rawBalance) ?? 0n) / 10 ** params.tokenDecimals;
    const poolPairTokenBalance = Number((poolBalances.find((b) => b.address.toLowerCase() === pairTokenAddress.toLowerCase())?.rawBalance) ?? 0n) / 10 ** pairDecimals;
    const liquidityUsd = poolOurTokenBalance * priceUsd + poolPairTokenBalance * pairUsd;

    return { priceUsd, marketCapUsd: priceUsd * circulatingSupply, liquidityUsd, circulatingSupply };
  } catch {
    return null;
  }
}
