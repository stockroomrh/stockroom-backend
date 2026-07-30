import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { AuthError } from "@/lib/server/auth/session";
import { requireProjectRole } from "@/lib/server/auth/roles";
import { ChainNotConfiguredError, syncProjectTreasury } from "@/lib/server/db/treasury-sync";
import { getProjectBundleBySlug } from "@/lib/server/db/queries";
import { checkRateLimit, RateLimitError } from "@/lib/server/rate-limit";

// Manual "resync" — any project operator or owner can trigger a fresh read of
// the treasury from chain. Real reads only; never fabricates a snapshot.
export async function POST(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { projectId, user } = await requireProjectRole(slug, "operator");
    checkRateLimit(`sync:${user.id}`, 10, 60);

    const service = getSupabaseServiceClient();
    if (!service) return NextResponse.json({ error: "Live mode is not configured yet." }, { status: 503 });

    await syncProjectTreasury(service, projectId);
    const bundle = await getProjectBundleBySlug(service, slug, "Operator");
    return NextResponse.json(bundle);
  } catch (cause) {
    if (cause instanceof AuthError) return NextResponse.json({ error: cause.message }, { status: 403 });
    if (cause instanceof RateLimitError) return NextResponse.json({ error: cause.message }, { status: 429, headers: { "Retry-After": String(cause.retryAfterSeconds) } });
    if (cause instanceof ChainNotConfiguredError) return NextResponse.json({ error: cause.message }, { status: 503 });
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Sync failed." }, { status: 500 });
  }
}
