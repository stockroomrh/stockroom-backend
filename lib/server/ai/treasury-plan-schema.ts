import { z } from "zod";

/**
 * Structured output contract for a Treasury Plan. Like CfoReportSchema, this
 * only constrains what the model may return — it says nothing about whether
 * any given step is compliant. Every step is independently evaluated by
 * lib/server/policy/policy-engine.ts, the same code path used for a
 * standalone recommendation, before it is stored or shown as approvable.
 */
export const PlanStepSchema = z.object({
  action: z.enum(["buy", "sell", "hold", "rebalance"]),
  assetSymbol: z.string().nullable(),
  amountUsd: z.number().nonnegative().nullable(),
  rationale: z.string(),
  // Human-readable condition for when this step should be executed, e.g.
  // "only after step 1 has settled and reserve is confirmed above 55%".
  condition: z.string(),
  // If set, describes when the operator should halt the remaining plan
  // rather than continue to the next step.
  stopRule: z.string().nullable(),
});

export const AllocationTargetSchema = z.object({
  symbol: z.string(),
  targetBps: z.number().int().min(0).max(10_000),
});

export const TreasuryPlanSchema = z.object({
  summary: z.string(),
  reserveTargetBps: z.number().int().min(0).max(10_000).nullable(),
  allocationTargets: z.array(AllocationTargetSchema),
  reviewCadence: z.enum(["daily", "weekly", "monthly"]),
  steps: z.array(PlanStepSchema),
});

export type PlanStep = z.infer<typeof PlanStepSchema>;
export type AllocationTarget = z.infer<typeof AllocationTargetSchema>;
export type TreasuryPlanOutput = z.infer<typeof TreasuryPlanSchema>;
