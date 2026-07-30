import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { AuthError } from "@/lib/server/auth/session";
import { requireProjectRole } from "@/lib/server/auth/roles";
import { generateAndStoreAgentReport } from "@/lib/server/db/agent-reports";
import { getProjectBundleBySlug } from "@/lib/server/db/queries";
import { checkRateLimit, RateLimitError } from "@/lib/server/rate-limit";

// Runs one Treasury Agent cycle: real treasury data -> AI report -> every
// recommendation independently policy-checked and stored. No trade is
// executed here — that's Stage 5. Owner/operator only.
export async function POST(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { projectId, user, role } = await requireProjectRole(slug, "operator");
    // Each call is a real, billed Anthropic API request — cap it well below
    // anything a legitimate operator would do manually (a few reviews a
    // session), since nothing else stands between this route and spend.
    checkRateLimit(`agent-generate:${user.id}`, 5, 300);

    const service = getSupabaseServiceClient();
    if (!service) return NextResponse.json({ error: "Live mode is not configured yet." }, { status: 503 });

    await generateAndStoreAgentReport(service, projectId, slug, user.id);
    const viewerRole = role === "owner" ? "Owner" : "Operator";
    const bundle = await getProjectBundleBySlug(service, slug, viewerRole);
    return NextResponse.json(bundle);
  } catch (cause) {
    if (cause instanceof AuthError) return NextResponse.json({ error: cause.message }, { status: 403 });
    if (cause instanceof RateLimitError) return NextResponse.json({ error: cause.message }, { status: 429, headers: { "Retry-After": String(cause.retryAfterSeconds) } });
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Failed to generate treasury review." }, { status: 500 });
  }
}
