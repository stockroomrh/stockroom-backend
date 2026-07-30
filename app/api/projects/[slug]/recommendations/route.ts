import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { AuthError } from "@/lib/server/auth/session";
import { requireProjectRole } from "@/lib/server/auth/roles";
import { getProjectPolicy } from "@/lib/server/db/queries";
import { getRecommendationsForProject } from "@/lib/server/db/agent-reports";

// Recommendations are never public — they're operator workflow, not the
// public ledger (enforced by RLS too; this just gives a clean 403 instead
// of a silently-empty list for non-members).
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { projectId } = await requireProjectRole(slug, "viewer");
    const supabase = await getSupabaseServerClient();
    if (!supabase) return NextResponse.json([], { status: 200 });

    const policy = await getProjectPolicy(supabase, projectId);
    const recommendations = await getRecommendationsForProject(supabase, projectId, slug, policy?.humanApproval ?? true);
    return NextResponse.json(recommendations);
  } catch (cause) {
    if (cause instanceof AuthError) return NextResponse.json({ error: cause.message }, { status: 403 });
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Unable to load recommendations." }, { status: 500 });
  }
}
