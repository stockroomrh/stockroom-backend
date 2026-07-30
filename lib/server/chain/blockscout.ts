import "server-only";
import { activeBlockExplorerUrl } from "@/lib/chain-config";

/**
 * Thin client for Blockscout's REST API v2. Preferred over raw RPC log
 * scanning for balances/history — Blockscout already indexes everything and
 * exposes it over plain HTTPS, no multicall or eth_getLogs pagination needed.
 *
 * Uses whichever explorer matches the currently active chain (testnet vs
 * mainnet) — previously hardcoded to the testnet-only env var, which meant
 * live/mainnet mode silently queried the wrong Blockscout instance.
 */

export function isBlockscoutConfigured() {
  return Boolean(activeBlockExplorerUrl);
}

function baseUrl() {
  if (!activeBlockExplorerUrl) throw new Error("No block explorer URL is configured for the active chain.");
  return activeBlockExplorerUrl.replace(/\/$/, "");
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Blockscout request failed: ${path} (${response.status})`);
  return (await response.json()) as T;
}

export type BlockscoutAddressInfo = {
  coin_balance: string | null;
  block_number_balance_updated_at: number | null;
};

export async function getAddressInfo(address: string): Promise<BlockscoutAddressInfo> {
  return get<BlockscoutAddressInfo>(`/api/v2/addresses/${address}`);
}

export type BlockscoutTokenBalance = {
  token: { address_hash: string; symbol: string; decimals: string; name: string };
  value: string;
};

export async function getTokenBalances(address: string): Promise<BlockscoutTokenBalance[]> {
  return get<BlockscoutTokenBalance[]>(`/api/v2/addresses/${address}/token-balances`);
}

export type BlockscoutTransaction = {
  hash: string;
  block_number: number;
  timestamp: string;
  from: { hash: string };
  to: { hash: string } | null;
  value: string;
  status: string;
  method: string | null;
};

export async function getTransactions(address: string): Promise<{ items: BlockscoutTransaction[] }> {
  return get<{ items: BlockscoutTransaction[] }>(`/api/v2/addresses/${address}/transactions`);
}

export type BlockscoutTokenTransfer = {
  transaction_hash: string;
  block_number: number;
  timestamp: string;
  from: { hash: string };
  to: { hash: string };
  total: { value: string; decimals: string };
  token: { address_hash: string; symbol: string };
};

export async function getTokenTransfers(address: string): Promise<{ items: BlockscoutTokenTransfer[] }> {
  return get<{ items: BlockscoutTokenTransfer[] }>(`/api/v2/addresses/${address}/token-transfers`);
}

export type BlockscoutTokenInfo = {
  holders_count: string | null;
  exchange_rate: string | null;
  circulating_market_cap: string | null;
};

/** Best-effort holder count for a deployed token. Price/market-cap fields come back null until
 *  Blockscout's own indexer picks up a price — real price/market cap instead comes from
 *  lib/server/chain/token-market.ts, read directly from the pool. */
export async function getTokenHolderCount(tokenAddress: string): Promise<number> {
  try {
    const info = await get<BlockscoutTokenInfo>(`/api/v2/tokens/${tokenAddress}`);
    return info.holders_count ? Number(info.holders_count) : 0;
  } catch {
    return 0;
  }
}

export function transactionUrl(hash: string) {
  return isBlockscoutConfigured() ? `${baseUrl()}/tx/${hash}` : "";
}

export function addressUrl(address: string) {
  return isBlockscoutConfigured() ? `${baseUrl()}/address/${address}` : "";
}
