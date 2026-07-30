import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { AuthError } from "@/lib/server/auth/session";
import { requireProjectRole } from "@/lib/server/auth/roles";
import { regeneratePlan } from "@/lib/server/db/treasury-plans";
import { checkRateLimit, RateLimitError } from "@/lib/server/rate-limit";

// Cancels every not-yet-decided step on the current plan and generates a
// fresh plan for the same objective against current live treasury state.
// Same billed-Anthropic-call rate limit as a first-time plan generation.
export async function POST(_request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { projectId, user } = await requireProjectRole(slug, "operator");
    checkRateLimit(`plan-generate:${user.id}`, 5, 300);

    const service = getSupabaseServiceClient();
    if (!service) return NextResponse.json({ error: "Live mode is not configured yet." }, { status: 503 });

    const plan = await regeneratePlan(service, projectId, slug, user.id, id);
    return NextResponse.json(plan);
  } catch (cause) {
    if (cause instanceof AuthError) return NextResponse.json({ error: cause.message }, { status: 403 });
    if (cause instanceof RateLimitError) return NextResponse.json({ error: cause.message }, { status: 429, headers: { "Retry-After": String(cause.retryAfterSeconds) } });
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Failed to regenerate treasury plan." }, { status: 500 });
  }
}
