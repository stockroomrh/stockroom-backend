import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { AuthError } from "@/lib/server/auth/session";
import { requireProjectRole } from "@/lib/server/auth/roles";
import { getProjectPolicy } from "@/lib/server/db/queries";
import { updateRecommendationStatus } from "@/lib/server/db/agent-reports";
import { checkRateLimit, RateLimitError } from "@/lib/server/rate-limit";

// Operator approve/reject on a single recommendation. The policy engine's
// own verdict (stored at generation time) is never re-derived or
// overridden here — this only records the human decision on top of it.
export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const body = (await request.json().catch(() => ({}))) as { status?: string };
    if (body.status !== "approved" && body.status !== "rejected") {
      return NextResponse.json({ error: 'Request body must include status: "approved" or "rejected".' }, { status: 400 });
    }

    const { projectId, user } = await requireProjectRole(slug, "operator");
    checkRateLimit(`recommendation-status:${user.id}`, 20, 60);
    const service = getSupabaseServiceClient();
    if (!service) return NextResponse.json({ error: "Live mode is not configured yet." }, { status: 503 });

    const policy = await getProjectPolicy(service, projectId);
    const recommendation = await updateRecommendationStatus(service, id, projectId, slug, body.status, user.id, policy?.humanApproval ?? true);
    return NextResponse.json(recommendation);
  } catch (cause) {
    if (cause instanceof AuthError) return NextResponse.json({ error: cause.message }, { status: 403 });
    if (cause instanceof RateLimitError) return NextResponse.json({ error: cause.message }, { status: 429, headers: { "Retry-After": String(cause.retryAfterSeconds) } });
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Failed to update recommendation." }, { status: 500 });
  }
}
