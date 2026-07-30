import { defineChain } from "viem";

export const ROBINHOOD_TESTNET_ID = 46630;
export const ROBINHOOD_MAINNET_ID = 4663;

// Universal convention used by 0x, 1inch, and other DEX aggregators to
// represent native ETH as a "token" address in a swap request/response —
// not a real deployed contract. Selling native ETH needs no ERC-20
// allowance/approve step at all; asset_registry stores this same value as
// ETH's contract_address on Robinhood mainnet (see lib/server/policy).
export const NATIVE_ETH_SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const;

// Deployed at this same address on nearly every EVM chain (deterministic
// CREATE2 deployment) — confirmed present on Robinhood Chain testnet via
// eth_getCode before relying on it for balance multicalls.
const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

export const activeChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? ROBINHOOD_TESTNET_ID);

export const robinhoodTestnet = defineChain({
  id: ROBINHOOD_TESTNET_ID,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_ROBINHOOD_TESTNET_RPC_URL || "https://testnet-rpc.robinhood-chain.example"] } },
  blockExplorers: { default: { name: "Blockscout", url: process.env.NEXT_PUBLIC_BLOCK_EXPLORER_URL || "https://explorer.testnet.robinhood.com" } },
  contracts: { multicall3: { address: MULTICALL3_ADDRESS } },
  testnet: true,
});

export const robinhoodMainnet = defineChain({
  id: ROBINHOOD_MAINNET_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_ROBINHOOD_MAINNET_RPC_URL || "https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: process.env.NEXT_PUBLIC_MAINNET_BLOCK_EXPLORER_URL || "https://robinhoodchain.blockscout.com" } },
  contracts: { multicall3: { address: MULTICALL3_ADDRESS } },
});

export const activeChain = activeChainId === ROBINHOOD_MAINNET_ID ? robinhoodMainnet : robinhoodTestnet;

// Server-side chain reads (RPC + Blockscout) must pick the same env-var pair
// the active chain uses — everything above this line was previously wired to
// a single testnet-only var each, so live/mainnet mode silently read testnet
// chain data. See lib/server/chain/client.ts and lib/server/chain/blockscout.ts.
export const activeAlchemyRpcUrl = activeChainId === ROBINHOOD_MAINNET_ID
  ? process.env.ALCHEMY_ROBINHOOD_MAINNET_RPC_URL
  : process.env.ALCHEMY_ROBINHOOD_RPC_URL;

export const activeBlockExplorerUrl = activeChain.blockExplorers.default.url;
