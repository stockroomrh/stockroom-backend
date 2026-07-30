import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { AuthError } from "@/lib/server/auth/session";
import { requireProjectRole } from "@/lib/server/auth/roles";
import { getChainClient } from "@/lib/server/chain/client";
import { getTradeExecution, finalizeTradeExecution } from "@/lib/server/db/trading";
import { syncProjectTreasury } from "@/lib/server/db/treasury-sync";
import { getProjectBundleBySlug } from "@/lib/server/db/queries";

// Polled by the frontend after broadcasting a swap. The server checks the
// transaction receipt onchain itself — it never trusts a client-reported
// "it worked" — and only on a verified success does it resync the treasury,
// mark the recommendation confirmed, and hand back fresh dashboard data.
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; id: string; executionId: string }> }) {
  const { slug, id, executionId } = await params;
  try {
    const { projectId, role } = await requireProjectRole(slug, "operator");
    const service = getSupabaseServiceClient();
    if (!service) return NextResponse.json({ error: "Live mode is not configured yet." }, { status: 503 });

    const execution = await getTradeExecution(service, executionId);
    if (!execution || execution.recommendation_id !== id) return NextResponse.json({ error: "Execution not found." }, { status: 404 });

    if (execution.status === "confirmed" || execution.status === "failed") {
      return NextResponse.json({ status: execution.status, failureReason: execution.failure_reason });
    }

    const client = getChainClient();
    if (!client) return NextResponse.json({ status: "submitted" });

    let receipt;
    try {
      receipt = await client.getTransactionReceipt({ hash: execution.swap_tx_hash as `0x${string}` });
    } catch {
      // Not mined yet — keep polling.
      return NextResponse.json({ status: "submitted" });
    }

    if (receipt.status === "success") {
      await finalizeTradeExecution(service, executionId, "confirmed", null);
      await service.from("recommendations").update({ status: "confirmed" }).eq("id", id);
      await service.from("recommendation_events").insert({ recommendation_id: id, event_type: "confirmed", detail: { swap_tx_hash: execution.swap_tx_hash } });

      try {
        await syncProjectTreasury(service, projectId);
      } catch {
        // Balance/valuation refresh is best-effort — the confirmation itself is already durably recorded.
      }

      const viewerRole = role === "owner" ? "Owner" : "Operator";
      const bundle = await getProjectBundleBySlug(service, slug, viewerRole);
      return NextResponse.json({ status: "confirmed", bundle });
    }

    const failureReason = "Transaction reverted onchain.";
    await finalizeTradeExecution(service, executionId, "failed", failureReason);
    await service.from("recommendations").update({ status: "failed" }).eq("id", id);
    await service.from("recommendation_events").insert({ recommendation_id: id, event_type: "failed", detail: { swap_tx_hash: execution.swap_tx_hash } });
    return NextResponse.json({ status: "failed", failureReason });
  } catch (cause) {
    if (cause instanceof AuthError) return NextResponse.json({ error: cause.message }, { status: 403 });
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Failed to check execution status." }, { status: 500 });
  }
}
