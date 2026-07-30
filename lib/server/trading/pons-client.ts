import "server-only";
import { createPublicClient, http } from "viem";
import { robinhoodMainnet } from "@/lib/chain-config";
import { PONS_LAUNCH_FACTORY_ADDRESS, PONS_LAUNCH_FACTORY_ABI } from "@/lib/contracts/pons-launch-factory";

/**
 * Pons only exists on Robinhood Chain **mainnet** — this client is
 * deliberately independent of the app's "active chain" (which defaults to
 * testnet). Every read here always targets mainnet regardless of
 * NEXT_PUBLIC_CHAIN_ID.
 */
export function isPonsConfigured(): boolean {
  return Boolean(process.env.ALCHEMY_ROBINHOOD_MAINNET_RPC_URL);
}

export class PonsNotConfiguredError extends Error {}

let mainnetClient: ReturnType<typeof createPublicClient> | null = null;
function getMainnetClient() {
  if (!isPonsConfigured()) return null;
  if (!mainnetClient) {
    mainnetClient = createPublicClient({ chain: robinhoodMainnet, transport: http(process.env.ALCHEMY_ROBINHOOD_MAINNET_RPC_URL) });
  }
  return mainnetClient;
}

export type PonsLaunchParams = {
  launchConfigId: bigint;
  dexId: bigint;
  launchFee: bigint;
};

async function firstEnabledId(
  client: NonNullable<ReturnType<typeof getMainnetClient>>,
  count: bigint,
  functionName: "getLaunchConfig" | "getDexConfig",
): Promise<bigint> {
  for (let id = 0n; id < count; id++) {
    const config = await client.readContract({
      address: PONS_LAUNCH_FACTORY_ADDRESS,
      abi: PONS_LAUNCH_FACTORY_ABI,
      functionName,
      args: [id],
    });
    if (config.enabled) return id;
  }
  throw new Error(`No enabled Pons ${functionName === "getLaunchConfig" ? "launch" : "dex"} config was found.`);
}

/**
 * Resolves the first *enabled* launch config and dex config (never blindly
 * assume index 0 is valid/enabled) plus the current launch fee, so the
 * frontend always quotes the real onchain cost.
 */
export async function resolvePonsLaunchParams(): Promise<PonsLaunchParams> {
  const client = getMainnetClient();
  if (!client) throw new PonsNotConfiguredError("Mainnet RPC is not configured (ALCHEMY_ROBINHOOD_MAINNET_RPC_URL).");

  const [launchConfigCount, dexConfigCount, launchFee] = await Promise.all([
    client.readContract({ address: PONS_LAUNCH_FACTORY_ADDRESS, abi: PONS_LAUNCH_FACTORY_ABI, functionName: "launchConfigCount" }),
    client.readContract({ address: PONS_LAUNCH_FACTORY_ADDRESS, abi: PONS_LAUNCH_FACTORY_ABI, functionName: "dexConfigCount" }),
    client.readContract({ address: PONS_LAUNCH_FACTORY_ADDRESS, abi: PONS_LAUNCH_FACTORY_ABI, functionName: "launchFee" }),
  ]);

  const [launchConfigId, dexId] = await Promise.all([
    firstEnabledId(client, launchConfigCount, "getLaunchConfig"),
    firstEnabledId(client, dexConfigCount, "getDexConfig"),
  ]);

  return { launchConfigId, dexId, launchFee };
}

/** Reads the locker contract's address from the factory — the factory is the source of truth, never hardcode the locker address. */
export async function getPonsLockerAddress() {
  const client = getMainnetClient();
  if (!client) throw new PonsNotConfiguredError("Mainnet RPC is not configured (ALCHEMY_ROBINHOOD_MAINNET_RPC_URL).");
  return client.readContract({ address: PONS_LAUNCH_FACTORY_ADDRESS, abi: PONS_LAUNCH_FACTORY_ABI, functionName: "locker" });
}

export { getMainnetClient as getPonsMainnetClient };
