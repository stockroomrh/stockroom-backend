import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { AuthError } from "@/lib/server/auth/session";
import { requireProjectRole } from "@/lib/server/auth/roles";
import { getTradeQuote, createTradeExecution } from "@/lib/server/db/trading";
import { checkRateLimit, RateLimitError } from "@/lib/server/rate-limit";

// Records a swap the operator has ALREADY signed and broadcast from their
// own wallet (the frontend calls this only after wagmi returns a real tx
// hash). This route never signs or submits anything itself — it's purely
// bookkeeping so the server can independently verify the receipt onchain
// (see the [executionId] route) rather than trusting the client's word that
// a trade succeeded.
export async function POST(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const body = (await request.json().catch(() => ({}))) as { quoteId?: string; swapTxHash?: string; approvalTxHash?: string };
    if (!body.quoteId || !body.swapTxHash) {
      return NextResponse.json({ error: "quoteId and swapTxHash are required." }, { status: 400 });
    }

    const { projectId, user } = await requireProjectRole(slug, "operator");
    checkRateLimit(`execute:${user.id}`, 10, 60);

    const service = getSupabaseServiceClient();
    if (!service) return NextResponse.json({ error: "Live mode is not configured yet." }, { status: 503 });

    const { data: recommendation, error: recError } = await service.from("recommendations").select("id, project_id").eq("id", id).maybeSingle();
    if (recError) throw new Error(recError.message);
    if (!recommendation || recommendation.project_id !== projectId) return NextResponse.json({ error: "Recommendation not found." }, { status: 404 });

    const quote = await getTradeQuote(service, body.quoteId);
    if (!quote || quote.recommendation_id !== id) return NextResponse.json({ error: "Quote not found for this recommendation." }, { status: 404 });

    const execution = await createTradeExecution(service, {
      quoteId: body.quoteId,
      recommendationId: id,
      operatorAddress: user.walletAddress,
      swapTxHash: body.swapTxHash,
      approvalTxHash: body.approvalTxHash ?? null,
    });

    await service.from("recommendations").update({ status: "submitted" }).eq("id", id);
    await service.from("recommendation_events").insert({
      recommendation_id: id,
      event_type: "submitted",
      actor_profile_id: user.id,
      detail: { swap_tx_hash: body.swapTxHash, approval_tx_hash: body.approvalTxHash ?? null },
    });

    return NextResponse.json({ executionId: execution.id, status: execution.status });
  } catch (cause) {
    if (cause instanceof AuthError) return NextResponse.json({ error: cause.message }, { status: 403 });
    if (cause instanceof RateLimitError) return NextResponse.json({ error: cause.message }, { status: 429, headers: { "Retry-After": String(cause.retryAfterSeconds) } });
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Failed to record the trade execution." }, { status: 500 });
  }
}
