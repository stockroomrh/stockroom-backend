import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AllocationTarget, PlanStatus, PlanStep, Recommendation, TreasuryPlan } from "@/lib/types";
import { formatDate, getTreasuryData } from "@/lib/server/db/queries";
import { generateTreasuryPlan } from "@/lib/server/ai/treasury-plan-service";
import type { TreasuryPlanPromptInput } from "@/lib/server/ai/treasury-plan-prompt";
import { evaluateRecommendation, type RecommendationAction } from "@/lib/server/policy/policy-engine";
import { buildPolicyEvaluationContext, resolveAssetRule } from "@/lib/server/policy/policy-context";

function mapPlanStatus(status: string): PlanStatus {
  if (status === "active") return "Active";
  if (status === "paused") return "Paused";
  if (status === "completed") return "Completed";
  if (status === "cancelled") return "Cancelled";
  return "Draft";
}

// Mirrors lib/server/db/agent-reports.ts's mapRecommendationRow exactly — a
// plan step's recommendation is stored, approved, quoted and executed
// through the exact same recommendations table and lifecycle.
function titleFor(action: string, assetSymbol: string | null): string {
  if (action === "HOLD") return "Hold — no action recommended";
  const verb = action === "BUY" || action === "REBALANCE" ? "Increase" : "Reduce";
  return assetSymbol ? `${verb} ${assetSymbol} position` : `${verb} allocation`;
}

const APPROVED_LIKE_STATUSES = new Set(["approved", "quote_requested", "awaiting_signature", "submitted", "confirmed"]);
const REJECTED_LIKE_STATUSES = new Set(["rejected", "policy_blocked", "quote_expired", "failed", "cancelled"]);

function statusToProposalStatus(status: string): Recommendation["status"] {
  if (APPROVED_LIKE_STATUSES.has(status)) return "Approved";
  if (REJECTED_LIKE_STATUSES.has(status)) return "Rejected";
  return "Pending";
}

function policyResultLabel(evaluation: { passed: boolean } | null, humanApprovalRequired: boolean): Recommendation["policyResult"] {
  if (!evaluation || !evaluation.passed) return "Fail";
  return humanApprovalRequired ? "Human approval" : "Pass";
}

type RecommendationRow = {
  id: string;
  action: string;
  asset_symbol: string | null;
  suggested_notional_usd: number | null;
  rationale: string;
  policy_result: { passed: boolean; checks: { name: string; passed: boolean; reason: string }[] } | null;
  status: string;
  created_at: string;
};

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

type PlanRow = {
  id: string;
  objective: string;
  reserve_target_bps: number | null;
  allocation_targets: AllocationTarget[];
  review_cadence: "daily" | "weekly" | "monthly";
  status: string;
  created_at: string;
};

type PlanStepRow = {
  id: string;
  plan_id: string;
  step_order: number;
  condition: string | null;
  stop_rule: string | null;
  recommendations: RecommendationRow | RecommendationRow[] | null;
};

const PLAN_STEP_SELECT = "id, plan_id, step_order, condition, stop_rule, recommendations(id, action, asset_symbol, suggested_notional_usd, rationale, policy_result, status, created_at)";

function firstRecommendation(value: RecommendationRow | RecommendationRow[] | null): RecommendationRow | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

// A recommendation's raw DB status (not the collapsed 3-value ProposalStatus
// the frontend uses) is what tells us whether a step is actually done. Terminal
// here means "nothing further will happen to this step without a human
// starting a new action" — a HOLD has no execution step, so "approved" is
// already its end state.
const TERMINAL_RECOMMENDATION_STATUSES = new Set(["policy_blocked", "rejected", "quote_expired", "confirmed", "failed", "cancelled"]);

function isStepTerminal(row: RecommendationRow): boolean {
  if (TERMINAL_RECOMMENDATION_STATUSES.has(row.status)) return true;
  if (row.action === "HOLD" && row.status === "approved") return true;
  return false;
}

async function mapPlanRow(row: PlanRow, stepRows: PlanStepRow[], projectSlug: string, humanApprovalRequired: boolean): Promise<TreasuryPlan> {
  const rawStepsForPlan = stepRows.filter((step) => step.plan_id === row.id).sort((a, b) => a.step_order - b.step_order);

  const steps: PlanStep[] = rawStepsForPlan.flatMap((step) => {
    const recRow = firstRecommendation(step.recommendations);
    if (!recRow) return [];
    return [{
      id: step.id,
      order: step.step_order,
      condition: step.condition ?? "",
      stopRule: step.stop_rule,
      recommendation: { ...mapRecommendationRow(recRow, projectSlug, humanApprovalRequired), planObjective: row.objective },
    }];
  });

  // Only "active" transitions to "completed" automatically — draft/paused/
  // cancelled are all operator- or generation-controlled states we never
  // want to silently override.
  const allStepsTerminal = rawStepsForPlan.length > 0 && rawStepsForPlan.every((step) => {
    const recRow = firstRecommendation(step.recommendations);
    return recRow ? isStepTerminal(recRow) : true;
  });
  const derivedStatus = row.status === "active" && allStepsTerminal ? "Completed" : mapPlanStatus(row.status);

  return {
    id: row.id,
    projectSlug,
    objective: row.objective,
    reserveTargetBps: row.reserve_target_bps,
    allocationTargets: row.allocation_targets ?? [],
    reviewCadence: row.review_cadence,
    status: derivedStatus,
    steps,
    createdAt: formatDate(row.created_at),
  };
}

export async function getTreasuryPlansForProject(
  supabase: SupabaseClient,
  projectId: string,
  projectSlug: string,
  humanApprovalRequired: boolean,
): Promise<TreasuryPlan[]> {
  const { data: planRows, error: planError } = await supabase
    .from("treasury_plans")
    .select("id, objective, reserve_target_bps, allocation_targets, review_cadence, status, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (planError) throw new Error(planError.message);
  const plans = (planRows ?? []) as unknown as PlanRow[];
  if (plans.length === 0) return [];

  const { data: stepRows, error: stepError } = await supabase
    .from("plan_steps")
    .select(PLAN_STEP_SELECT)
    .in("plan_id", plans.map((p) => p.id));
  if (stepError) throw new Error(stepError.message);

  const steps = (stepRows ?? []) as unknown as PlanStepRow[];
  return Promise.all(plans.map((plan) => mapPlanRow(plan, steps, projectSlug, humanApprovalRequired)));
}

export async function getTreasuryPlan(
  supabase: SupabaseClient,
  projectId: string,
  projectSlug: string,
  planId: string,
  humanApprovalRequired: boolean,
): Promise<TreasuryPlan | null> {
  const { data: planRow, error: planError } = await supabase
    .from("treasury_plans")
    .select("id, objective, reserve_target_bps, allocation_targets, review_cadence, status, created_at")
    .eq("id", planId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (planError) throw new Error(planError.message);
  if (!planRow) return null;

  const { data: stepRows, error: stepError } = await supabase
    .from("plan_steps")
    .select(PLAN_STEP_SELECT)
    .eq("plan_id", planId);
  if (stepError) throw new Error(stepError.message);

  return mapPlanRow(planRow as unknown as PlanRow, (stepRows ?? []) as unknown as PlanStepRow[], projectSlug, humanApprovalRequired);
}

/**
 * Generates one Treasury Plan: builds the plan prompt from real, live
 * treasury state, calls the Agent (deterministic fallback baked into
 * generateTreasuryPlan), then independently validates EVERY step with
 * evaluateRecommendation exactly as a standalone recommendation would be —
 * storing each step as its own row in `recommendations`, linked via
 * plan_steps for ordering and conditions only. The model's judgement never
 * determines a step's policy_result or status.
 */
export async function generateAndStorePlan(
  supabase: SupabaseClient,
  projectId: string,
  projectSlug: string,
  actorProfileId: string,
  planObjective: string,
): Promise<TreasuryPlan> {
  const { data: projectRow, error: projectError } = await supabase
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .single();
  if (projectError || !projectRow) throw new Error(projectError?.message ?? "Project not found.");

  const context = await buildPolicyEvaluationContext(supabase, projectId);
  const { policy, tradingPaused, totalValueUsd, reserveValueUsd, cryptoValueUsd, positionValueBySymbol } = context;
  const { summary, positions, activity } = await getTreasuryData(supabase, projectId, policy);

  const promptInput: TreasuryPlanPromptInput = {
    projectName: projectRow.name as string,
    planObjective,
    summary,
    positions,
    activity,
    policy,
  };

  const generation = await generateTreasuryPlan(promptInput);

  const { data: insertedPlan, error: insertPlanError } = await supabase
    .from("treasury_plans")
    .insert({
      project_id: projectId,
      objective: planObjective,
      reserve_target_bps: generation.plan.reserveTargetBps,
      allocation_targets: generation.plan.allocationTargets,
      review_cadence: generation.plan.reviewCadence,
      status: "active",
      model: generation.model,
      prompt_version: generation.promptVersion,
      created_by: actorProfileId,
    })
    .select("id, objective, reserve_target_bps, allocation_targets, review_cadence, status, created_at")
    .single();
  if (insertPlanError || !insertedPlan) throw new Error(insertPlanError?.message ?? "Failed to store the treasury plan.");

  const stepRows: PlanStepRow[] = [];

  for (let index = 0; index < generation.plan.steps.length; index++) {
    const step = generation.plan.steps[index];
    const action = step.action.toUpperCase() as RecommendationAction;
    const assetSymbol = step.assetSymbol;
    const amountUsd = step.amountUsd ?? 0;

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
      expiresAt: action === "HOLD" ? null : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const status = action === "HOLD" ? "pending_review" : evaluation.passed ? "pending_review" : "policy_blocked";

    const { data: insertedRec, error: insertRecError } = await supabase
      .from("recommendations")
      .insert({
        project_id: projectId,
        action,
        asset_symbol: assetSymbol,
        suggested_notional_usd: action === "HOLD" ? null : amountUsd,
        rationale: step.rationale,
        policy_result: evaluation,
        status,
        expires_at: action === "HOLD" ? null : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select("id, action, asset_symbol, suggested_notional_usd, rationale, policy_result, status, created_at")
      .single();
    if (insertRecError || !insertedRec) throw new Error(insertRecError?.message ?? "Failed to store a plan step's recommendation.");

    await supabase.from("recommendation_events").insert({
      recommendation_id: insertedRec.id,
      event_type: "generated",
      actor_profile_id: actorProfileId,
      detail: { policy_result: evaluation, model: generation.model, plan_id: insertedPlan.id, step_order: index },
    });

    const { data: insertedStep, error: insertStepError } = await supabase
      .from("plan_steps")
      .insert({
        plan_id: insertedPlan.id,
        recommendation_id: insertedRec.id,
        step_order: index,
        condition: step.condition,
        stop_rule: step.stopRule,
      })
      .select("id, plan_id, step_order, condition, stop_rule")
      .single();
    if (insertStepError || !insertedStep) throw new Error(insertStepError?.message ?? "Failed to store a plan step.");

    stepRows.push({ ...insertedStep, recommendations: insertedRec as unknown as RecommendationRow });
  }

  return mapPlanRow(insertedPlan as unknown as PlanRow, stepRows, projectSlug, policy.humanApproval);
}

/** Pauses a plan — remaining steps stay exactly as they are, just not actioned further. */
export async function setPlanStatus(
  supabase: SupabaseClient,
  projectId: string,
  projectSlug: string,
  planId: string,
  nextStatus: "active" | "paused" | "cancelled",
  humanApprovalRequired: boolean,
): Promise<TreasuryPlan> {
  const { data: current, error: currentError } = await supabase
    .from("treasury_plans")
    .select("id, status, project_id")
    .eq("id", planId)
    .single();
  if (currentError || !current) throw new Error(currentError?.message ?? "Plan not found.");
  if (current.project_id !== projectId) throw new Error("Plan does not belong to this project.");
  if (current.status === "cancelled") {
    throw new Error(`This plan is already "${current.status}" and cannot change status.`);
  }
  // "completed" isn't stored — it's derived from every step being terminal —
  // so check the derived view rather than the raw column.
  const existing = await getTreasuryPlan(supabase, projectId, projectSlug, planId, humanApprovalRequired);
  if (existing?.status === "Completed") throw new Error('This plan is already "completed" and cannot change status.');

  const { error: updateError } = await supabase.from("treasury_plans").update({ status: nextStatus, updated_at: new Date().toISOString() }).eq("id", planId);
  if (updateError) throw new Error(updateError.message);

  const plan = await getTreasuryPlan(supabase, projectId, projectSlug, planId, humanApprovalRequired);
  if (!plan) throw new Error("Plan not found after update.");
  return plan;
}

/**
 * Regenerates a plan: cancels every step still awaiting a decision (an
 * approved/executed step is history and is left untouched), marks the old
 * plan cancelled, then generates a brand new plan for the same objective
 * against current live treasury state.
 */
export async function regeneratePlan(
  supabase: SupabaseClient,
  projectId: string,
  projectSlug: string,
  actorProfileId: string,
  planId: string,
): Promise<TreasuryPlan> {
  const { data: current, error: currentError } = await supabase
    .from("treasury_plans")
    .select("id, objective, project_id, status")
    .eq("id", planId)
    .single();
  if (currentError || !current) throw new Error(currentError?.message ?? "Plan not found.");
  if (current.project_id !== projectId) throw new Error("Plan does not belong to this project.");
  const existing = await getTreasuryPlan(supabase, projectId, projectSlug, planId, true);
  if (existing?.status === "Completed") throw new Error("A completed plan cannot be regenerated.");

  const { data: stepRows, error: stepError } = await supabase
    .from("plan_steps")
    .select("recommendation_id, recommendations(status)")
    .eq("plan_id", planId);
  if (stepError) throw new Error(stepError.message);

  const cancellableIds = ((stepRows ?? []) as unknown as { recommendation_id: string; recommendations: { status: string } | { status: string }[] | null }[])
    .filter((row) => {
      const rec = Array.isArray(row.recommendations) ? row.recommendations[0] : row.recommendations;
      return rec?.status === "pending_review";
    })
    .map((row) => row.recommendation_id);

  if (cancellableIds.length > 0) {
    const { error: cancelError } = await supabase.from("recommendations").update({ status: "cancelled" }).in("id", cancellableIds);
    if (cancelError) throw new Error(cancelError.message);
    for (const recommendationId of cancellableIds) {
      await supabase.from("recommendation_events").insert({
        recommendation_id: recommendationId,
        event_type: "cancelled",
        actor_profile_id: actorProfileId,
        detail: { reason: "plan_regenerated", plan_id: planId },
      });
    }
  }

  const { error: cancelPlanError } = await supabase.from("treasury_plans").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", planId);
  if (cancelPlanError) throw new Error(cancelPlanError.message);

  return generateAndStorePlan(supabase, projectId, projectSlug, actorProfileId, current.objective as string);
}
