import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { AuthError } from "@/lib/server/auth/session";
import { requireProjectRole } from "@/lib/server/auth/roles";
import { getProjectBundleBySlug, updateApprovedAssets } from "@/lib/server/db/queries";
import { TreasuryAssetRuleSchema } from "@/lib/schemas";
import { z } from "zod";

const BodySchema = z.object({ assetRules: z.array(TreasuryAssetRuleSchema) });

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    // Only owners and operators may change approved-asset policy.
    const { projectId } = await requireProjectRole(slug, "operator");
    const { assetRules } = BodySchema.parse(await request.json());

    const service = getSupabaseServiceClient();
    if (!service) return NextResponse.json({ error: "Live mode is not configured yet." }, { status: 503 });

    await updateApprovedAssets(service, projectId, assetRules);
    const bundle = await getProjectBundleBySlug(service, slug, "Operator");
    return NextResponse.json(bundle);
  } catch (cause) {
    if (cause instanceof AuthError) return NextResponse.json({ error: cause.message }, { status: 403 });
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Unable to update assets." }, { status: 500 });
  }
}
