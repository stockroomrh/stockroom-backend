import { NextResponse } from "next/server";
import { parseEventLogs } from "viem";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { AuthError } from "@/lib/server/auth/session";
import { requireProjectRole } from "@/lib/server/auth/roles";
import { getChainClient } from "@/lib/server/chain/client";
import { getPonsMainnetClient, isPonsConfigured } from "@/lib/server/trading/pons-client";
import { PONS_LAUNCH_FACTORY_ADDRESS, PONS_LAUNCH_FACTORY_ABI } from "@/lib/contracts/pons-launch-factory";
import { getProjectBundleBySlug } from "@/lib/server/db/queries";
import { activeChainId, ROBINHOOD_MAINNET_ID } from "@/lib/chain-config";
import { checkRateLimit, RateLimitError } from "@/lib/server/rate-limit";

// Records a token the operator already deployed/launched from their OWN
// connected wallet (see components/LaunchWizard.tsx). This route never
// deploys, signs, or broadcasts anything itself — it independently verifies
// the transaction onchain before trusting any of it, then stores the result.
//
// Two provider paths:
//  - "stockroom" (testnet): a plain StockroomToken.sol deployment. The token
//    address comes from receipt.contractAddress (a raw CREATE).
//  - "pons" (mainnet only): a PonsLaunchFactory.launchToken() call. There is
//    no receipt.contractAddress for a factory call — the real token + pool
//    addresses are read from the TokenLaunched event log instead, and the
//    event's own `deployer` field is cross-checked against the
//    authenticated wallet so a client can't claim someone else's launch.
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      contractAddress?: string;
      deploymentTxHash?: string;
      launchProvider?: "stockroom" | "pons";
    };
    if (!body.contractAddress || !body.deploymentTxHash) {
      return NextResponse.json({ error: "contractAddress and deploymentTxHash are required." }, { status: 400 });
    }
    const launchProvider = body.launchProvider === "pons" ? "pons" : "stockroom";

    const { projectId, user, role } = await requireProjectRole(slug, "owner");
    checkRateLimit(`token-deploy:${user.id}`, 5, 60);

    const service = getSupabaseServiceClient();
    if (!service) return NextResponse.json({ error: "Live mode is not configured yet." }, { status: 503 });

    let poolAddress: string | null = null;
    let deploymentBlock: number;
    let chainIdForRecord: number;

    if (launchProvider === "pons") {
      if (!isPonsConfigured()) return NextResponse.json({ error: "Pons is not configured yet (ALCHEMY_ROBINHOOD_MAINNET_RPC_URL is missing)." }, { status: 503 });
      const client = getPonsMainnetClient();
      if (!client) return NextResponse.json({ error: "Mainnet RPC is not configured yet." }, { status: 503 });

      let receipt;
      try {
        receipt = await client.getTransactionReceipt({ hash: body.deploymentTxHash as `0x${string}` });
      } catch {
        return NextResponse.json({ error: "Could not find that launch transaction onchain yet — it may still be pending." }, { status: 422 });
      }
      if (receipt.status !== "success") {
        return NextResponse.json({ error: "That transaction reverted onchain — the token was not launched." }, { status: 422 });
      }
      if (receipt.from.toLowerCase() !== user.walletAddress.toLowerCase()) {
        return NextResponse.json({ error: "This launch was not sent from your authenticated wallet." }, { status: 403 });
      }

      const events = parseEventLogs({
        abi: PONS_LAUNCH_FACTORY_ABI,
        eventName: "TokenLaunched",
        logs: receipt.logs.filter((log) => log.address.toLowerCase() === PONS_LAUNCH_FACTORY_ADDRESS.toLowerCase()),
      });
      const launchEvent = events[0];
      if (!launchEvent) {
        return NextResponse.json({ error: "No TokenLaunched event was found on that transaction — it may not be a real Pons launch." }, { status: 422 });
      }
      if (launchEvent.args.deployer.toLowerCase() !== user.walletAddress.toLowerCase()) {
        return NextResponse.json({ error: "The launch event's deployer does not match your authenticated wallet." }, { status: 403 });
      }
      if (launchEvent.args.token.toLowerCase() !== body.contractAddress.toLowerCase()) {
        return NextResponse.json({ error: "The launched token address does not match the transaction receipt." }, { status: 422 });
      }

      poolAddress = launchEvent.args.pool;
      deploymentBlock = Number(receipt.blockNumber);
      chainIdForRecord = ROBINHOOD_MAINNET_ID;
    } else {
      const client = getChainClient();
      if (!client) return NextResponse.json({ error: "Chain RPC is not configured yet." }, { status: 503 });

      let receipt;
      try {
        receipt = await client.getTransactionReceipt({ hash: body.deploymentTxHash as `0x${string}` });
      } catch {
        return NextResponse.json({ error: "Could not find that deployment transaction onchain yet — it may still be pending." }, { status: 422 });
      }
      if (receipt.status !== "success") {
        return NextResponse.json({ error: "That transaction reverted onchain — the token was not deployed." }, { status: 422 });
      }
      if (!receipt.contractAddress || receipt.contractAddress.toLowerCase() !== body.contractAddress.toLowerCase()) {
        return NextResponse.json({ error: "The deployed contract address does not match the transaction receipt." }, { status: 422 });
      }
      if (receipt.from.toLowerCase() !== user.walletAddress.toLowerCase()) {
        return NextResponse.json({ error: "This deployment was not sent from your authenticated wallet." }, { status: 403 });
      }
      deploymentBlock = Number(receipt.blockNumber);
      chainIdForRecord = activeChainId;
    }

    const { error: updateError } = await service
      .from("project_tokens")
      .update({
        contract_address: body.contractAddress,
        chain_id: chainIdForRecord,
        deployment_tx_hash: body.deploymentTxHash,
        deployment_block: deploymentBlock,
        deployer_address: user.walletAddress,
        launch_provider: launchProvider,
        pool_address: poolAddress,
        status: "deployed",
      })
      .eq("project_id", projectId);
    if (updateError) throw new Error(updateError.message);

    const viewerRole = role === "owner" ? "Owner" : "Operator";
    const bundle = await getProjectBundleBySlug(service, slug, viewerRole);
    return NextResponse.json(bundle);
  } catch (cause) {
    if (cause instanceof AuthError) return NextResponse.json({ error: cause.message }, { status: 403 });
    if (cause instanceof RateLimitError) return NextResponse.json({ error: cause.message }, { status: 429, headers: { "Retry-After": String(cause.retryAfterSeconds) } });
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Failed to record the token deployment." }, { status: 500 });
  }
}
