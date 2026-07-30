import "server-only";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { getChainClient } from "@/lib/server/chain/client";
import {
  UNISWAP_V3_FACTORY_ABI,
  UNISWAP_V3_FACTORY_ADDRESS,
  UNISWAP_V3_FEE_TIERS,
  UNISWAP_V3_POOL_ABI,
  UNISWAP_V3_SWAP_ROUTER_ABI,
  UNISWAP_V3_SWAP_ROUTER_ADDRESS,
} from "@/lib/contracts/uniswap-v3";

export class UniswapQuoteError extends Error {}

export type UniswapSwapQuote = {
  buyAmount: string;
  minBuyAmount: string;
  totalNetworkFee: string | null;
  allowanceTarget: Address;
  transaction: { to: Address; data: Hex; value: string; gas: string | null };
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

async function findPool(client: NonNullable<ReturnType<typeof getChainClient>>, tokenA: Address, tokenB: Address) {
  for (const fee of UNISWAP_V3_FEE_TIERS) {
    const pool = await client.readContract({ address: UNISWAP_V3_FACTORY_ADDRESS, abi: UNISWAP_V3_FACTORY_ABI, functionName: "getPool", args: [tokenA, tokenB, fee] });
    if (pool.toLowerCase() !== ZERO_ADDRESS) return { pool, fee };
  }
  return null;
}

/**
 * Real, executable swap via direct Uniswap V3 interaction — the path for
 * Stock/ETF token trades, which 0x's swap API refuses outright ("not
 * authorized for trade due to legal restrictions"). Price comes from the
 * pool's own slot0() (a live spot-price read, not a simulated/firm quote
 * the way 0x's is), so a wider slippage buffer is applied than the 0x path
 * uses, and a real eth_estimateGas call is made rather than trusting a
 * provider-returned estimate.
 */
export async function getUniswapSwapQuote(input: {
  sellToken: Address;
  buyToken: Address;
  sellAmount: bigint;
  sellDecimals: number;
  buyDecimals: number;
  recipient: Address;
}): Promise<UniswapSwapQuote> {
  const client = getChainClient();
  if (!client) throw new UniswapQuoteError("Chain RPC is not configured — cannot price a Uniswap swap.");

  const found = await findPool(client, input.sellToken, input.buyToken);
  if (!found) throw new UniswapQuoteError("No Uniswap V3 pool exists for this pair yet — this asset cannot be traded onchain right now.");

  const [slot0, token0] = await Promise.all([
    client.readContract({ address: found.pool, abi: UNISWAP_V3_POOL_ABI, functionName: "slot0" }),
    client.readContract({ address: found.pool, abi: UNISWAP_V3_POOL_ABI, functionName: "token0" }),
  ]);

  const isSellToken0 = token0.toLowerCase() === input.sellToken.toLowerCase();
  const sqrtPriceX96 = slot0[0];
  const Q96 = 2 ** 96;
  const sqrtPrice = Number(sqrtPriceX96) / Q96;
  const rawRatioToken1PerToken0 = sqrtPrice ** 2;
  const decimals0 = isSellToken0 ? input.sellDecimals : input.buyDecimals;
  const decimals1 = isSellToken0 ? input.buyDecimals : input.sellDecimals;
  const displayRatioToken1PerToken0 = rawRatioToken1PerToken0 * 10 ** decimals0 / 10 ** decimals1;
  const buyPerSell = isSellToken0 ? displayRatioToken1PerToken0 : 1 / displayRatioToken1PerToken0;

  const sellDisplay = Number(input.sellAmount) / 10 ** input.sellDecimals;
  const expectedBuyDisplay = sellDisplay * buyPerSell;
  const buyAmount = BigInt(Math.floor(expectedBuyDisplay * 10 ** input.buyDecimals));
  if (buyAmount <= 0n) throw new UniswapQuoteError("Computed buy amount is zero.");

  // 2% slippage tolerance — wider than the 0x path's, since this is a spot
  // price read rather than a firm, provider-simulated quote.
  const minBuyAmount = (buyAmount * 98n) / 100n;

  const swapArgs = {
    tokenIn: input.sellToken,
    tokenOut: input.buyToken,
    fee: found.fee,
    recipient: input.recipient,
    amountIn: input.sellAmount,
    amountOutMinimum: minBuyAmount,
    sqrtPriceLimitX96: 0n,
  } as const;

  const data = encodeFunctionData({ abi: UNISWAP_V3_SWAP_ROUTER_ABI, functionName: "exactInputSingle", args: [swapArgs] });

  let gas: string | null = null;
  try {
    const estimated = await client.estimateContractGas({
      address: UNISWAP_V3_SWAP_ROUTER_ADDRESS,
      abi: UNISWAP_V3_SWAP_ROUTER_ABI,
      functionName: "exactInputSingle",
      args: [swapArgs],
      account: input.recipient,
    });
    gas = estimated.toString();
  } catch {
    // Estimation can fail if the caller doesn't yet hold an ERC-20 allowance
    // for the router — the wallet will still estimate correctly once the
    // approve step (handled client-side, same as the 0x path) has gone
    // through. Not fatal: the wallet does its own estimation at sign time.
  }

  return {
    buyAmount: buyAmount.toString(),
    minBuyAmount: minBuyAmount.toString(),
    totalNetworkFee: null,
    allowanceTarget: UNISWAP_V3_SWAP_ROUTER_ADDRESS,
    transaction: { to: UNISWAP_V3_SWAP_ROUTER_ADDRESS, data, value: "0", gas },
  };
}
