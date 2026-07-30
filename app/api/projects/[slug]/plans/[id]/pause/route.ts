import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { AuthError } from "@/lib/server/auth/session";
import { requireProjectRole } from "@/lib/server/auth/roles";
import { getProjectPolicy } from "@/lib/server/db/queries";
import { setPlanStatus } from "@/lib/server/db/treasury-plans";

// Pauses (or resumes) a plan. This only stops further plan-level action —
// it does not touch any step's own recommendation status or policy result.
export async function POST(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const body = (await request.json().catch(() => ({}))) as { resume?: boolean };
    const { projectId } = await requireProjectRole(slug, "operator");
    const service = getSupabaseServiceClient();
    if (!service) return NextResponse.json({ error: "Live mode is not configured yet." }, { status: 503 });

    const policy = await getProjectPolicy(service, projectId);
    const plan = await setPlanStatus(service, projectId, slug, id, body.resume ? "active" : "paused", policy?.humanApproval ?? true);
    return NextResponse.json(plan);
  } catch (cause) {
    if (cause instanceof AuthError) return NextResponse.json({ error: cause.message }, { status: 403 });
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Failed to update plan status." }, { status: 500 });
  }
}
