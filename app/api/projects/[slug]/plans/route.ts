import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { AuthError } from "@/lib/server/auth/session";
import { requireProjectRole } from "@/lib/server/auth/roles";
import { getProjectPolicy } from "@/lib/server/db/queries";
import { generateAndStorePlan, getTreasuryPlansForProject } from "@/lib/server/db/treasury-plans";
import { checkRateLimit, RateLimitError } from "@/lib/server/rate-limit";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { projectId } = await requireProjectRole(slug, "viewer");
    const service = getSupabaseServiceClient();
    if (!service) return NextResponse.json({ error: "Live mode is not configured yet." }, { status: 503 });

    const policy = await getProjectPolicy(service, projectId);
    const plans = await getTreasuryPlansForProject(service, projectId, slug, policy?.humanApproval ?? true);
    return NextResponse.json(plans);
  } catch (cause) {
    if (cause instanceof AuthError) return NextResponse.json({ error: cause.message }, { status: 403 });
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Failed to load treasury plans." }, { status: 500 });
  }
}

// Generates a new Treasury Plan: real treasury data -> staged Agent plan ->
// every step independently policy-checked and stored as its own
// recommendation. Each call is a real, billed Anthropic request, capped the
// same way as a single-report generation. Owner/operator only.
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const body = (await request.json().catch(() => ({}))) as { objective?: string };
    if (!body.objective || !body.objective.trim()) {
      return NextResponse.json({ error: "Request body must include a non-empty objective." }, { status: 400 });
    }

    const { projectId, user } = await requireProjectRole(slug, "operator");
    checkRateLimit(`plan-generate:${user.id}`, 5, 300);

    const service = getSupabaseServiceClient();
    if (!service) return NextResponse.json({ error: "Live mode is not configured yet." }, { status: 503 });

    const plan = await generateAndStorePlan(service, projectId, slug, user.id, body.objective.trim());
    return NextResponse.json(plan);
  } catch (cause) {
    if (cause instanceof AuthError) return NextResponse.json({ error: cause.message }, { status: 403 });
    if (cause instanceof RateLimitError) return NextResponse.json({ error: cause.message }, { status: 429, headers: { "Retry-After": String(cause.retryAfterSeconds) } });
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Failed to generate treasury plan." }, { status: 500 });
  }
}
