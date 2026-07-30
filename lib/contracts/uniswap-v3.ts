/**
 * Bindings for the canonical Uniswap V3 deployment on Robinhood Chain
 * mainnet — the same Factory/SwapRouter Pons's own dexConfig points at
 * (verified via lib/server/trading/pons-client.ts's getDexConfig(0) read).
 * ABI entries copied verbatim from Blockscout's verified source
 * (GET /api/v2/smart-contracts/{address}) on 2026-07-27.
 *
 * Used specifically for Stock/ETF token trades — 0x's swap API explicitly
 * refuses these ("not authorized for trade due to legal restrictions"),
 * but real, actively-traded Uniswap V3 pools exist for them directly
 * (confirmed via GeckoTerminal: NVDA/USDG, AAPL/USDG, TSLA/USDG, MSFT/USDG,
 * SPY/USDG, AMZN/USDG all have real volume). Crypto/stablecoin trades
 * (ETH, WETH, USDG) keep using 0x, which has no such restriction for them.
 *
 * MAINNET ONLY, same as Pons — this chain has no testnet Stock Token
 * deployment.
 */
export const UNISWAP_V3_FACTORY_ADDRESS = "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA" as const;
export const UNISWAP_V3_SWAP_ROUTER_ADDRESS = "0xCaf681a66D020601342297493863E78C959E5cb2" as const;

// Fee tiers observed in real pools so far: NVDA/USDG at 0.05% (500), most
// others (AAPL, TSLA, MSFT, SPY, AMZN) at 0.3% (3000). Try both plus the 1%
// tier rather than assume one — getPool() returns the zero address for any
// tier with no deployed pool, so trying all three is cheap and correct.
export const UNISWAP_V3_FEE_TIERS = [500, 3000, 10000] as const;

export const UNISWAP_V3_FACTORY_ABI = [
  {
    inputs: [
      { internalType: "address", name: "", type: "address" },
      { internalType: "address", name: "", type: "address" },
      { internalType: "uint24", name: "", type: "uint24" },
    ],
    name: "getPool",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export const UNISWAP_V3_POOL_ABI = [
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

// SwapRouter02's ExactInputSingleParams — confirmed via the verified ABI to
// have NO deadline field (unlike the original SwapRouter's ISwapRouter),
// unlike a commonly-misremembered version of this interface.
export const UNISWAP_V3_SWAP_ROUTER_ABI = [
  {
    inputs: [
      {
        components: [
          { internalType: "address", name: "tokenIn", type: "address" },
          { internalType: "address", name: "tokenOut", type: "address" },
          { internalType: "uint24", name: "fee", type: "uint24" },
          { internalType: "address", name: "recipient", type: "address" },
          { internalType: "uint256", name: "amountIn", type: "uint256" },
          { internalType: "uint256", name: "amountOutMinimum", type: "uint256" },
          { internalType: "uint160", name: "sqrtPriceLimitX96", type: "uint160" },
        ],
        internalType: "struct IV3SwapRouter.ExactInputSingleParams",
        name: "params",
        type: "tuple",
      },
    ],
    name: "exactInputSingle",
    outputs: [{ internalType: "uint256", name: "amountOut", type: "uint256" }],
    stateMutability: "payable",
    type: "function",
  },
] as const;
