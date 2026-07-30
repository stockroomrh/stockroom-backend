import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Records a sensitive administrative action to `audit_logs` — policy/asset
 * changes, recommendation approvals, trade executions. Best-effort: a
 * logging failure must never block the underlying action it's describing,
 * since the action has already succeeded by the time this is called.
 */
export async function recordAuditLog(
  supabase: SupabaseClient,
  params: { projectId: string; actorProfileId: string; action: string; detail?: Record<string, unknown> },
): Promise<void> {
  try {
    await supabase.from("audit_logs").insert({
      project_id: params.projectId,
      actor_profile_id: params.actorProfileId,
      action: params.action,
      detail: params.detail ?? null,
    });
  } catch {
    // Audit logging is best-effort — see comment above.
  }
}
