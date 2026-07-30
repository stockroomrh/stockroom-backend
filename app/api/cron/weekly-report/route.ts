import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { generateAndStoreAgentReport } from "@/lib/server/db/agent-reports";

// Scheduled weekly treasury review for every published project — same
// generateAndStoreAgentReport() path the "Generate treasury review" button
// calls, just triggered on a schedule instead of by an operator. Attributed
// to the project's own owner_profile_id in the event log (there's no human
// actor for a cron-triggered run, and that's a defensible "on behalf of the
// owner" semantic without needing a schema change for a synthetic system
// actor). Configured as a Vercel Cron job in vercel.json; any other
// scheduler just needs to hit this route with the same header.
//
// Protected by CRON_SECRET so this can't be triggered by anyone who finds
// the URL — Vercel Cron sends this automatically as a Bearer token; other
// schedulers need to be configured to send the same header.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const service = getSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "Live mode is not configured yet." }, { status: 503 });

  const { data: projects, error } = await service.from("projects").select("id, slug, owner_profile_id").eq("status", "published");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: { slug: string; ok: boolean; error?: string }[] = [];
  for (const project of projects ?? []) {
    try {
      await generateAndStoreAgentReport(service, project.id, project.slug, project.owner_profile_id);
      results.push({ slug: project.slug, ok: true });
    } catch (cause) {
      // One project's report failing (e.g. no treasury indexed yet) must
      // never stop the rest of the run.
      results.push({ slug: project.slug, ok: false, error: cause instanceof Error ? cause.message : "Unknown error" });
    }
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), projectCount: results.length, succeeded: results.filter((r) => r.ok).length, results });
}
