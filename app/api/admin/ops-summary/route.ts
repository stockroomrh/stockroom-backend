import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { AuthError, requireUser } from "@/lib/server/auth/session";
import { firstOf } from "@/lib/server/db/queries";

export type OpsSummaryRow = {
  slug: string;
  name: string;
  role: string;
  status: string;
  treasuryAddress: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  tokenStatus: string;
  launchProvider: string | null;
  tokenDeployed: boolean;
  tradingPaused: boolean;
  pendingApprovedAssetSymbols: string[];
};

type AssetRegistryRow = { symbol: string; contract_address: string };
type ApprovedAssetRow = { asset_registry: AssetRegistryRow | AssetRegistryRow[] | null };

// Ops/admin visibility — every project the signed-in wallet is a member of
// (owner or operator), scoped exactly like /api/projects/mine so this never
// exposes another user's projects: there's no platform-wide "admin" role in
// this app, only per-project owner/operator membership, and this route
// deliberately doesn't invent one. Surfaces the same class of gap that bit
// us repeatedly today (stale/failed syncs, assets still on a "pending:*"
// placeholder address, a token that was never actually deployed) so an
// operator can catch them without digging through the database by hand.
export async function GET() {
  try {
    const user = await requireUser();
    const supabase = await getSupabaseServerClient();
    if (!supabase) throw new AuthError("Live mode is not configured yet (Supabase is not connected).");

    const { data: memberships, error } = await supabase
      .from("project_members")
      .select("role, projects(id, slug, name, status)")
      .eq("profile_id", user.id)
      .eq("is_active", true);
    if (error) throw error;

    const roleLabel = { owner: "Owner", operator: "Operator", viewer: "Viewer" } as const;

    const rows = await Promise.all(
      (memberships ?? []).map(async (membership): Promise<OpsSummaryRow | null> => {
        const project = Array.isArray(membership.projects) ? membership.projects[0] : membership.projects;
        if (!project) return null;

        const [{ data: treasury }, { data: token }, { data: policy }, { data: approvedAssets }] = await Promise.all([
          supabase.from("treasury_accounts").select("address, last_synced_at, last_sync_error").eq("project_id", project.id).maybeSingle(),
          supabase.from("project_tokens").select("status, launch_provider, contract_address").eq("project_id", project.id).maybeSingle(),
          supabase.from("treasury_policies").select("trading_paused").eq("project_id", project.id).maybeSingle(),
          supabase.from("project_approved_assets").select("asset_registry(symbol, contract_address)").eq("project_id", project.id).eq("approved", true),
        ]);

        const pendingApprovedAssetSymbols = ((approvedAssets ?? []) as unknown as ApprovedAssetRow[])
          .map((row) => firstOf(row.asset_registry))
          .filter((asset): asset is AssetRegistryRow => Boolean(asset) && asset!.contract_address.startsWith("pending:"))
          .map((asset) => asset.symbol);

        return {
          slug: project.slug,
          name: project.name,
          role: roleLabel[membership.role as "owner" | "operator" | "viewer"],
          status: project.status,
          treasuryAddress: treasury?.address ?? null,
          lastSyncedAt: treasury?.last_synced_at ?? null,
          lastSyncError: treasury?.last_sync_error ?? null,
          tokenStatus: token?.status ?? "not_deployed",
          launchProvider: token?.launch_provider ?? null,
          tokenDeployed: Boolean(token?.contract_address && !token.contract_address.startsWith("pending:")),
          tradingPaused: Boolean(policy?.trading_paused),
          pendingApprovedAssetSymbols,
        };
      }),
    );

    return NextResponse.json(rows.filter((row): row is OpsSummaryRow => row !== null));
  } catch (cause) {
    if (cause instanceof AuthError) return NextResponse.json({ error: cause.message }, { status: 401 });
    return NextResponse.json({ error: "Unable to load ops summary." }, { status: 500 });
  }
}
