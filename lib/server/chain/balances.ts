import "server-only";
import { erc20Abi, type Address } from "viem";
import { getChainClient } from "./client";

export type OnchainBalance = { address: Address; rawBalance: bigint; success: boolean };

/** Native ETH balance for the treasury address, in wei. Returns null if RPC isn't configured. */
export async function getNativeBalance(address: Address): Promise<bigint | null> {
  const client = getChainClient();
  if (!client) return null;
  return client.getBalance({ address });
}

/**
 * Batched ERC-20 balanceOf reads via multicall — one RPC round-trip for every
 * approved asset rather than one call each. Per-asset failures (e.g. a
 * contract that reverts) don't fail the whole batch; they're marked
 * success:false so the caller can show a per-asset error instead of losing
 * every other balance.
 */
export async function getErc20Balances(treasuryAddress: Address, tokenAddresses: Address[]): Promise<OnchainBalance[]> {
  const client = getChainClient();
  if (!client || tokenAddresses.length === 0) return tokenAddresses.map((address) => ({ address, rawBalance: 0n, success: false }));

  const results = await client.multicall({
    contracts: tokenAddresses.map((address) => ({ address, abi: erc20Abi, functionName: "balanceOf", args: [treasuryAddress] }) as const),
  });

  return results.map((result, index) => ({
    address: tokenAddresses[index],
    rawBalance: result.status === "success" ? (result.result as bigint) : 0n,
    success: result.status === "success",
  }));
}

export async function getCurrentBlockNumber(): Promise<bigint | null> {
  const client = getChainClient();
  if (!client) return null;
  return client.getBlockNumber();
}
