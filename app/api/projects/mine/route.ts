import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { AuthError, requireUser } from "@/lib/server/auth/session";
import { getProjectBundleBySlug } from "@/lib/server/db/queries";

// Live "My Projects": every project the signed-in wallet is a member of, with
// enough of the bundle to render the dashboard cards. Real, database-backed —
// empty for a brand-new account, never seeded with mock rows.
export async function GET() {
  try {
    const user = await requireUser();
    const supabase = await getSupabaseServerClient();
    if (!supabase) throw new AuthError("Live mode is not configured yet (Supabase is not connected).");

    const { data: memberships, error } = await supabase
      .from("project_members")
      .select("role, projects(slug, status)")
      .eq("profile_id", user.id)
      .eq("is_active", true);
    if (error) throw error;

    const roleLabel = { owner: "Owner", operator: "Operator", viewer: "Viewer" } as const;

    const items = await Promise.all(
      (memberships ?? []).map(async (membership) => {
        const projectRef = Array.isArray(membership.projects) ? membership.projects[0] : membership.projects;
        if (!projectRef) return null;
        const bundle = await getProjectBundleBySlug(supabase, projectRef.slug, roleLabel[membership.role as "owner" | "operator" | "viewer"]);
        if (!bundle) return null;
        return {
          projectSlug: projectRef.slug,
          role: roleLabel[membership.role as "owner" | "operator" | "viewer"],
          operationalStatus: bundle.userProject.operationalStatus,
          pendingRecommendations: bundle.recommendations.filter((item) => item.status === "Pending").length,
          project: bundle.project,
          summary: bundle.summary,
          latestActivity: bundle.activity[0] ?? null,
        };
      }),
    );

    return NextResponse.json(items.filter(Boolean));
  } catch (cause) {
    if (cause instanceof AuthError) return NextResponse.json({ error: cause.message }, { status: 401 });
    return NextResponse.json({ error: "Unable to load your projects." }, { status: 500 });
  }
}
