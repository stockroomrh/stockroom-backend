import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentReport, HealthStatus, Recommendation } from "@/lib/types";
import { formatDate, getTreasuryData } from "@/lib/server/db/queries";
import { generateCfoReport } from "@/lib/server/ai/cfo-service";
import type { CfoPromptInput } from "@/lib/server/ai/cfo-prompt";
import { evaluateRecommendation, type PolicyEvaluation, type RecommendationAction } from "@/lib/server/policy/policy-engine";
import { buildPolicyEvaluationContext, resolveAssetRule } from "@/lib/server/policy/policy-context";
import { recordAuditLog } from "@/lib/server/db/audit-log";

function mapHealth(value: "healthy" | "watch" | "critical"): HealthStatus {
  if (value === "healthy") return "HEALTHY";
  if (value === "watch") return "WATCH";
  return "AT RISK";
}

type AgentReportRow = {
  id: string;
  created_at: string;
  financial_health: "healthy" | "watch" | "critical";
  summary: string;
  findings: string[];
  warnings: string[];
};

function mapReportRow(row: AgentReportRow, policyValidation: string): AgentReport {
  return {
    id: row.id,
    createdAt: formatDate(row.created_at),
    health: mapHealth(row.financial_health),
    title: "Treasury review",
    summary: row.summary,
    findings: row.findings ?? [],
    warnings: row.warnings ?? [],
    policyValidation,
  };
}

type RecommendationRow = {
  id: string;
  action: string;
  asset_symbol: string | null;
  suggested_notional_usd: number | null;
  rationale: string;
  policy_result: PolicyEvaluation | null;
  status: string;
  created_at: string;
};

// The DB tracks the full trade lifecycle (approved -> quote_requested ->
// submitted -> confirmed, or any of several failure states); the frontend's
// ProposalStatus type only has three values, so every in-flight or completed
// trade state collapses to "Approved" and every failure/expiry to "Rejected".
// components/trading/LiveSwapPanel.tsx drives its own state machine
// independently of this simplified mapping.
const APPROVED_LIKE_STATUSES = new Set(["approved", "quote_requested", "awaiting_signature", "submitted", "confirmed"]);
const REJECTED_LIKE_STATUSES = new Set(["rejected", "policy_blocked", "quote_expired", "failed", "cancelled"]);

function statusToProposalStatus(status: string): Recommendation["status"] {
  if (APPROVED_LIKE_STATUSES.has(status)) return "Approved";
  if (REJECTED_LIKE_STATUSES.has(status)) return "Rejected";
  return "Pending";
}

function policyResultLabel(evaluation: PolicyEvaluation | null, humanApprovalRequired: boolean): Recommendation["policyResult"] {
  if (!evaluation || !evaluation.passed) return "Fail";
  return humanApprovalRequired ? "Human approval" : "Pass";
}

function titleFor(action: string, assetSymbol: string | null): string {
  if (action === "HOLD") return "Hold — no action recommended";
  const verb = action === "BUY" || action === "REBALANCE" ? "Increase" : "Reduce";
  return assetSymbol ? `${verb} ${assetSymbol} position` : `${verb} allocation`;
}

function mapRecommendationRow(row: RecommendationRow, projectSlug: string, humanApprovalRequired: boolean): Recommendation {
  const amountUsd = row.suggested_notional_usd ?? 0;
  const isIntoAsset = row.action === "BUY" || row.action === "REBALANCE";
  const isIntoReserve = row.action === "SELL" || row.action === "BUILD_RESERVES";
  return {
    id: row.id,
    projectSlug,
    title: titleFor(row.action, row.asset_symbol),
    amount: `$${amountUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    amountUsd,
    status: statusToProposalStatus(row.status),
    rationale: row.rationale,
    action: row.action,
    fromAsset: isIntoAsset ? "USDG" : row.asset_symbol ?? "—",
    toAsset: isIntoAsset ? row.asset_symbol ?? "—" : isIntoReserve ? "USDG" : "—",
    policyResult: policyResultLabel(row.policy_result, humanApprovalRequired),
    policyChecks: row.policy_result?.checks ?? [],
    createdAt: formatDate(row.created_at),
  };
}

export async function getAgentReportsForProject(supabase: SupabaseClient, projectId: string): Promise<AgentReport[]> {
  const { data, error } = await supabase
    .from("agent_reports")
    .select("id, created_at, financial_health, summary, findings, warnings")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as AgentReportRow[];
  if (rows.length === 0) return [];

  const { data: recRows, error: recError } = await supabase
    .from("recommendations")
    .select("report_id, status")
    .in("report_id", rows.map((row) => row.id));
  if (recError) throw new Error(recError.message);

  const countsByReport = new Map<string, { total: number; passed: number }>();
  for (const rec of (recRows ?? []) as { report_id: string | null; status: string }[]) {
    if (!rec.report_id) continue;
    const entry = countsByReport.get(rec.report_id) ?? { total: 0, passed: 0 };
    entry.total++;
    if (rec.status !== "policy_blocked") entry.passed++;
    countsByReport.set(rec.report_id, entry);
  }

  return rows.map((row) => {
    const counts = countsByReport.get(row.id);
    const policyValidation = !counts || counts.total === 0
      ? "No trade recommendations were proposed in this run."
      : `${counts.passed} of ${counts.total} recommendation${counts.total === 1 ? "" : "s"} passed automated policy validation.`;
    return mapReportRow(row, policyValidation);
  });
}

export async function getRecommendationsForProject(supabase: SupabaseClient, projectId: string, projectSlug: string, humanApprovalRequired: boolean): Promise<Recommendation[]> {
  const { data, error } = await supabase
    .from("recommendations")
    .select("id, action, asset_symbol, suggested_notional_usd, rationale, policy_result, status, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as RecommendationRow[];
  if (rows.length === 0) return [];

  // A recommendation that's actually a plan step is otherwise indistinguishable
  // from a standalone one here — tag it with its plan's objective so the
  // Recommendations tab doesn't silently duplicate what the Plans tab shows.
  const { data: planStepRows, error: planStepError } = await supabase
    .from("plan_steps")
    .select("recommendation_id, treasury_plans(objective)")
    .in("recommendation_id", rows.map((row) => row.id));
  if (planStepError) throw new Error(planStepError.message);

  const objectiveByRecommendationId = new Map<string, string>();
  for (const step of (planStepRows ?? []) as unknown as { recommendation_id: string; treasury_plans: { objective: string } | { objective: string }[] | null }[]) {
    const plan = Array.isArray(step.treasury_plans) ? step.treasury_plans[0] : step.treasury_plans;
    if (plan) objectiveByRecommendationId.set(step.recommendation_id, plan.objective);
  }

  return rows.map((row) => ({ ...mapRecommendationRow(row, projectSlug, humanApprovalRequired), planObjective: objectiveByRecommendationId.get(row.id) ?? null }));
}

/**
 * Runs one full Treasury Agent cycle: builds the prompt from real treasury
 * data, calls the AI model (with a deterministic fallback baked into
 * generateCfoReport), then independently validates every proposed
 * recommendation with the policy engine before storing anything. The model's
 * own judgement never determines policy_result or status.
 */
export async function generateAndStoreAgentReport(
  supabase: SupabaseClient,
  projectId: string,
  projectSlug: string,
  actorProfileId: string,
): Promise<{ report: AgentReport; recommendations: Recommendation[] }> {
  const { data: projectRow, error: projectError } = await supabase
    .from("projects")
    .select("name, treasury_objective")
    .eq("id", projectId)
    .single();
  if (projectError || !projectRow) throw new Error(projectError?.message ?? "Project not found.");

  const context = await buildPolicyEvaluationContext(supabase, projectId);
  const { policy, tradingPaused, totalValueUsd, reserveValueUsd, cryptoValueUsd, positionValueBySymbol } = context;

  const { summary, positions, activity } = await getTreasuryData(supabase, projectId, policy);

  const { data: snapshotRow, error: snapshotError } = await supabase
    .from("treasury_snapshots")
    .select("id")
    .eq("project_id", projectId)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (snapshotError) throw new Error(snapshotError.message);

  const previousReports = await getAgentReportsForProject(supabase, projectId);
  const openRecommendations = await getRecommendationsForProject(supabase, projectId, projectSlug, policy.humanApproval);

  const promptInput: CfoPromptInput = {
    projectName: projectRow.name as string,
    treasuryObjective: projectRow.treasury_objective as string,
    summary,
    positions,
    activity,
    policy,
    previousReports,
    openRecommendations,
  };

  const generation = await generateCfoReport(promptInput);

  const dbHealth = generation.report.healthClassification;
  const { data: insertedReport, error: insertReportError } = await supabase
    .from("agent_reports")
    .insert({
      project_id: projectId,
      snapshot_id: snapshotRow?.id ?? null,
      report_type: "manual",
      financial_health: dbHealth,
      summary: generation.report.summary,
      findings: generation.report.findings,
      warnings: generation.report.warnings,
      public_report: generation.report.summary,
      model: generation.model,
      prompt_version: generation.promptVersion,
      raw_response: generation.rawResponse ? JSON.parse(JSON.stringify(generation.rawResponse)) : null,
      is_public: true,
    })
    .select("id, created_at, financial_health, summary, findings, warnings")
    .single();
  if (insertReportError || !insertedReport) throw new Error(insertReportError?.message ?? "Failed to store the agent report.");

  const storedRecommendations: Recommendation[] = [];
  let passedCount = 0;

  for (const rec of generation.report.recommendations) {
    const action = rec.action.toUpperCase() as RecommendationAction;
    const assetSymbol = rec.assetSymbol;
    const amountUsd = rec.amountUsd ?? 0;

    const assetRule = assetSymbol ? await resolveAssetRule(supabase, projectId, assetSymbol) : null;
    const currentAssetValueUsd = assetSymbol ? positionValueBySymbol.get(assetSymbol.toLowerCase()) ?? 0 : 0;

    const evaluation = evaluateRecommendation({
      action,
      assetSymbol: assetSymbol ?? "",
      amountUsd,
      tradingPaused,
      minimumReserveBps: Math.round(policy.minimumReserve * 100),
      maximumSingleAssetBps: Math.round(policy.maximumSingleAsset * 100),
      maximumCryptoBps: Math.round(policy.maximumCrypto * 100),
      maximumTradeBps: Math.round(policy.maximumTrade * 100),
      assetRule,
      totalValueUsd,
      reserveValueUsd,
      currentAssetValueUsd,
      cryptoValueUsd,
      expiresAt: action === "HOLD" ? null : new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    if (evaluation.passed) passedCount++;
    const status = action === "HOLD" ? "pending_review" : evaluation.passed ? "pending_review" : "policy_blocked";

    const { data: insertedRec, error: insertRecError } = await supabase
      .from("recommendations")
      .insert({
        report_id: insertedReport.id,
        project_id: projectId,
        action,
        asset_symbol: assetSymbol,
        suggested_notional_usd: action === "HOLD" ? null : amountUsd,
        rationale: rec.rationale,
        urgency: rec.urgency,
        policy_result: evaluation,
        status,
        expires_at: action === "HOLD" ? null : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .select("id, action, asset_symbol, suggested_notional_usd, rationale, policy_result, status, created_at")
      .single();
    if (insertRecError || !insertedRec) throw new Error(insertRecError?.message ?? "Failed to store a recommendation.");

    await supabase.from("recommendation_events").insert({
      recommendation_id: insertedRec.id,
      event_type: "generated",
      actor_profile_id: actorProfileId,
      detail: { policy_result: evaluation, model: generation.model },
    });

    storedRecommendations.push(mapRecommendationRow(insertedRec as unknown as RecommendationRow, projectSlug, policy.humanApproval));
  }

  const total = generation.report.recommendations.length;
  const policyValidation = total === 0
    ? "No trade recommendations were proposed this run."
    : `${passedCount} of ${total} recommendation${total === 1 ? "" : "s"} passed automated policy validation.`;

  return { report: mapReportRow(insertedReport as unknown as AgentReportRow, policyValidation), recommendations: storedRecommendations };
}

const RECOMMENDATION_STATUS_RANK: Record<string, number> = { pending_review: 0 };

/**
 * Operator approve/reject action. Only a recommendation currently awaiting
 * review can transition — a policy-blocked recommendation cannot be
 * approved around the policy engine, and an already-decided one is final.
 */
export async function updateRecommendationStatus(
  supabase: SupabaseClient,
  recommendationId: string,
  projectId: string,
  projectSlug: string,
  nextStatus: "approved" | "rejected",
  actorProfileId: string,
  humanApprovalRequired: boolean,
): Promise<Recommendation> {
  const { data: current, error: currentError } = await supabase
    .from("recommendations")
    .select("id, status, project_id")
    .eq("id", recommendationId)
    .single();
  if (currentError || !current) throw new Error(currentError?.message ?? "Recommendation not found.");
  if (current.project_id !== projectId) throw new Error("Recommendation does not belong to this project.");
  if (!(current.status in RECOMMENDATION_STATUS_RANK)) {
    throw new Error(`This recommendation is "${current.status}" and can no longer be ${nextStatus === "approved" ? "approved" : "rejected"}.`);
  }

  const { data: updated, error: updateError } = await supabase
    .from("recommendations")
    .update({
      status: nextStatus,
      approved_by: nextStatus === "approved" ? actorProfileId : null,
      approved_at: nextStatus === "approved" ? new Date().toISOString() : null,
    })
    .eq("id", recommendationId)
    .select("id, action, asset_symbol, suggested_notional_usd, rationale, policy_result, status, created_at")
    .single();
  if (updateError || !updated) throw new Error(updateError?.message ?? "Failed to update recommendation.");

  await supabase.from("recommendation_events").insert({
    recommendation_id: recommendationId,
    event_type: nextStatus,
    actor_profile_id: actorProfileId,
    detail: null,
  });

  await recordAuditLog(supabase, {
    projectId,
    actorProfileId,
    action: `recommendation.${nextStatus}`,
    detail: { recommendationId, action: updated.action, assetSymbol: updated.asset_symbol },
  });

  return mapRecommendationRow(updated as unknown as RecommendationRow, projectSlug, humanApprovalRequired);
}
