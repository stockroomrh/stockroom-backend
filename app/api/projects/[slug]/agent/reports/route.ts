import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getProjectRowBySlug } from "@/lib/server/db/queries";
import { getAgentReportsForProject } from "@/lib/server/db/agent-reports";

// Public reports (is_public + published project) are visible to anyone via
// RLS; internal reports require membership — enforced at the database, not
// here, so this route needs no auth check of its own.
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const supabase = await getSupabaseServerClient();
    if (!supabase) return NextResponse.json([], { status: 200 });

    const row = await getProjectRowBySlug(supabase, slug);
    if (!row) return NextResponse.json({ error: `Project "${slug}" was not found.` }, { status: 404 });

    const reports = await getAgentReportsForProject(supabase, row.id);
    return NextResponse.json(reports);
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Unable to load agent reports." }, { status: 500 });
  }
}
