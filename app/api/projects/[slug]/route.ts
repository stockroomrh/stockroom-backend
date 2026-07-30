import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getProjectRowBySlug, mapProject } from "@/lib/server/db/queries";
import { ProjectSchema } from "@/lib/schemas";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const supabase = await getSupabaseServerClient();
    if (!supabase) return NextResponse.json(null, { status: 404 });
    const row = await getProjectRowBySlug(supabase, slug);
    if (!row) return NextResponse.json(null, { status: 404 });
    return NextResponse.json(ProjectSchema.parse(mapProject(row)));
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Unable to load project." }, { status: 500 });
  }
}
