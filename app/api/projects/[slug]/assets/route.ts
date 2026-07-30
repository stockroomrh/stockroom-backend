import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { AuthError } from "@/lib/server/auth/session";
import { requireProjectRole } from "@/lib/server/auth/roles";
import { getProjectBundleBySlug, updateApprovedAssets } from "@/lib/server/db/queries";
import { recordAuditLog } from "@/lib/server/db/audit-log";
import { checkRateLimit, RateLimitError } from "@/lib/server/rate-limit";
import { TreasuryAssetRuleSchema } from "@/lib/schemas";
import { z } from "zod";

const BodySchema = z.object({ assetRules: z.array(TreasuryAssetRuleSchema) });

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    // Only owners and operators may change approved-asset policy.
    const { projectId, user } = await requireProjectRole(slug, "operator");
    checkRateLimit(`assets-update:${user.id}`, 10, 60);
    const { assetRules } = BodySchema.parse(await request.json());

    const service = getSupabaseServiceClient();
    if (!service) return NextResponse.json({ error: "Live mode is not configured yet." }, { status: 503 });

    await updateApprovedAssets(service, projectId, assetRules);
    await recordAuditLog(service, {
      projectId,
      actorProfileId: user.id,
      action: "policy.assets_updated",
      detail: { assetRules: assetRules.map((rule) => ({ symbol: rule.symbol, approved: rule.approved })) },
    });
    const bundle = await getProjectBundleBySlug(service, slug, "Operator");
    return NextResponse.json(bundle);
  } catch (cause) {
    if (cause instanceof AuthError) return NextResponse.json({ error: cause.message }, { status: 403 });
    if (cause instanceof RateLimitError) return NextResponse.json({ error: cause.message }, { status: 429, headers: { "Retry-After": String(cause.retryAfterSeconds) } });
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Unable to update assets." }, { status: 500 });
  }
}
