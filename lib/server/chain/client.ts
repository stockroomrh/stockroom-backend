import "server-only";
import { createPublicClient, http } from "viem";
import { activeChain, activeAlchemyRpcUrl } from "@/lib/chain-config";

export function isRpcConfigured() {
  return Boolean(activeAlchemyRpcUrl);
}

let client: ReturnType<typeof createPublicClient> | null = null;

/** Server-only RPC client for direct chain reads (Chainlink feeds, fresh balances). Returns null if unconfigured. */
export function getChainClient() {
  if (!isRpcConfigured()) return null;
  if (!client) {
    client = createPublicClient({ chain: activeChain, transport: http(activeAlchemyRpcUrl) });
  }
  return client;
}
