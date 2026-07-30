import { NextResponse } from "next/server";
import { getSupabaseServerClient, getSupabaseServiceClient } from "@/lib/supabase/server";
import { AuthError, requireUser } from "@/lib/server/auth/session";
import { createProject, getProjectBundleBySlug, listPublishedProjects } from "@/lib/server/db/queries";
import { recordAuditLog } from "@/lib/server/db/audit-log";
import { checkRateLimit, RateLimitError } from "@/lib/server/rate-limit";
import { LaunchProjectInputSchema, ProjectSchema } from "@/lib/schemas";

export async function GET() {
  try {
    const supabase = await getSupabaseServerClient();
    if (!supabase) return NextResponse.json({ error: "Live mode is not configured yet." }, { status: 503 });
    const projects = await listPublishedProjects(supabase);
    return NextResponse.json(projects.map((project) => ProjectSchema.parse(project)));
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Unable to load projects." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    checkRateLimit(`project-create:${user.id}`, 5, 300);
    const body = await request.json();
    const input = LaunchProjectInputSchema.parse(body);

    // Business logic (ownership, membership bootstrap) is authorized in
    // application code above via requireUser(); the service-role client is
    // required here because project_members' own RLS policy can't grant the
    // very first membership row for a brand-new project (chicken-and-egg).
    const service = getSupabaseServiceClient();
    if (!service) return NextResponse.json({ error: "Live mode is not configured yet." }, { status: 503 });

    const { slug } = await createProject(service, user.id, input);
    const { data: createdProject } = await service.from("projects").select("id").eq("slug", slug).maybeSingle();
    if (createdProject) {
      await recordAuditLog(service, {
        projectId: createdProject.id as string,
        actorProfileId: user.id,
        action: "project.created",
        detail: { slug, name: input.projectName, ticker: input.projectSymbol },
      });
    }

    // Read back through the service client too — the caller's session-scoped
    // client may not see the freshly published row within the same request
    // due to short-lived read-replica lag on some Supabase plans.
    const bundle = await getProjectBundleBySlug(service, slug, "Owner");
    if (!bundle) return NextResponse.json({ error: "Project was created but could not be loaded." }, { status: 500 });
    return NextResponse.json(bundle);
  } catch (cause) {
    if (cause instanceof AuthError) return NextResponse.json({ error: cause.message }, { status: 401 });
    if (cause instanceof RateLimitError) return NextResponse.json({ error: cause.message }, { status: 429, headers: { "Retry-After": String(cause.retryAfterSeconds) } });
    if (cause && typeof cause === "object" && "issues" in cause) {
      return NextResponse.json({ error: "Invalid project details.", issues: (cause as { issues: unknown }).issues }, { status: 400 });
    }
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Unable to create project." }, { status: 500 });
  }
}
