import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getProjectBundleBySlug } from "@/lib/server/db/queries";
import { requireUser } from "@/lib/server/auth/session";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const supabase = await getSupabaseServerClient();
    if (!supabase) return NextResponse.json(null, { status: 404 });

    // Best-effort viewer role: public visitors see "Viewer"; if signed in and
    // a member, reflect their real role. Never blocks anonymous public reads
    // — RLS on the underlying tables (published-only) is the actual gate.
    let viewerRole: "Owner" | "Operator" | "Viewer" = "Viewer";
    try {
      const user = await requireUser();
      const { data: membership } = await supabase
        .from("project_members")
        .select("role, projects!inner(slug)")
        .eq("profile_id", user.id)
        .eq("projects.slug", slug)
        .maybeSingle();
      if (membership?.role === "owner") viewerRole = "Owner";
      else if (membership?.role === "operator") viewerRole = "Operator";
    } catch {
      // not authenticated — fine, stays "Viewer"
    }

    const bundle = await getProjectBundleBySlug(supabase, slug, viewerRole);
    if (!bundle) return NextResponse.json(null, { status: 404 });
    return NextResponse.json(bundle);
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Unable to load project." }, { status: 500 });
  }
}
