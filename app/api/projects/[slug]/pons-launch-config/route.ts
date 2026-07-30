import { NextResponse } from "next/server";
import { AuthError } from "@/lib/server/auth/session";
import { requireProjectRole } from "@/lib/server/auth/roles";
import { resolvePonsLaunchParams, getPonsLockerAddress, PonsNotConfiguredError } from "@/lib/server/trading/pons-client";
import { PONS_LAUNCH_FACTORY_ADDRESS } from "@/lib/contracts/pons-launch-factory";

// Resolves the current, real onchain Pons launch parameters (which
// launch/dex config is enabled right now, the current launch fee, and the
// locker address for claiming trading fees) so the frontend never hardcodes
// values that could go stale if Pons changes its config. Read-only — never
// launches or claims anything itself.
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    await requireProjectRole(slug, "owner");
    const [resolved, lockerAddress] = await Promise.all([resolvePonsLaunchParams(), getPonsLockerAddress()]);
    return NextResponse.json({
      factoryAddress: PONS_LAUNCH_FACTORY_ADDRESS,
      lockerAddress,
      launchConfigId: resolved.launchConfigId.toString(),
      dexId: resolved.dexId.toString(),
      launchFee: resolved.launchFee.toString(),
    });
  } catch (cause) {
    if (cause instanceof AuthError) return NextResponse.json({ error: cause.message }, { status: 403 });
    if (cause instanceof PonsNotConfiguredError) return NextResponse.json({ error: cause.message }, { status: 503 });
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Failed to resolve Pons launch config." }, { status: 500 });
  }
}
