import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { AuthError } from "@/lib/server/auth/session";
import { requireProjectRole } from "@/lib/server/auth/roles";
import { getProjectPolicy } from "@/lib/server/db/queries";
import { getTreasuryPlan } from "@/lib/server/db/treasury-plans";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { projectId } = await requireProjectRole(slug, "viewer");
    const service = getSupabaseServiceClient();
    if (!service) return NextResponse.json({ error: "Live mode is not configured yet." }, { status: 503 });

    const policy = await getProjectPolicy(service, projectId);
    const plan = await getTreasuryPlan(service, projectId, slug, id, policy?.humanApproval ?? true);
    if (!plan) return NextResponse.json({ error: "Plan not found." }, { status: 404 });
    return NextResponse.json(plan);
  } catch (cause) {
    if (cause instanceof AuthError) return NextResponse.json({ error: cause.message }, { status: 403 });
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Failed to load treasury plan." }, { status: 500 });
  }
}
