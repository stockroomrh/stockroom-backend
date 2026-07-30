import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { AuthError, requireUser } from "./session";

export type ProjectRole = "owner" | "operator" | "viewer";

const ROLE_RANK: Record<ProjectRole, number> = { viewer: 0, operator: 1, owner: 2 };

/**
 * Confirms the current authenticated user holds at least `minimumRole` on the
 * given project (looked up by slug), via project_members + RLS. Throws
 * AuthError if unauthenticated or unauthorized — callers should catch and
 * translate to a 401/403 response.
 */
export async function requireProjectRole(projectSlug: string, minimumRole: ProjectRole) {
  const user = await requireUser();
  const supabase = await getSupabaseServerClient();
  if (!supabase) throw new AuthError("Live mode is not configured yet (Supabase is not connected).");

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id")
    .eq("slug", projectSlug)
    .single();
  if (projectError || !project) throw new AuthError(`Project "${projectSlug}" was not found.`);

  const { data: membership, error: membershipError } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", project.id)
    .eq("profile_id", user.id)
    .single();
  if (membershipError || !membership) throw new AuthError(`You do not have access to project "${projectSlug}".`);

  const role = membership.role as ProjectRole;
  if (ROLE_RANK[role] < ROLE_RANK[minimumRole]) {
    throw new AuthError(`This action requires the "${minimumRole}" role; you have "${role}".`);
  }

  return { user, projectId: project.id as string, role };
}
