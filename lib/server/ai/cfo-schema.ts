import { z } from "zod";

/**
 * Structured output contract for the Treasury Agent ("AI CFO"). This schema
 * constrains what the model is allowed to return — it says nothing about
 * whether a recommendation is actually compliant. Compliance is decided
 * exclusively by lib/server/policy/policy-engine.ts, run independently for
 * every recommendation the model proposes.
 */
export const CfoRecommendationSchema = z.object({
  action: z.enum(["buy", "sell", "hold", "rebalance"]),
  // Null for "hold" — there is nothing to size or target.
  assetSymbol: z.string().nullable(),
  amountUsd: z.number().nonnegative().nullable(),
  rationale: z.string(),
  urgency: z.enum(["low", "medium", "high"]),
});

export const CfoReportSchema = z.object({
  healthClassification: z.enum(["healthy", "watch", "critical"]),
  summary: z.string(),
  findings: z.array(z.string()),
  warnings: z.array(z.string()),
  recommendations: z.array(CfoRecommendationSchema),
});

export type CfoRecommendation = z.infer<typeof CfoRecommendationSchema>;
export type CfoReport = z.infer<typeof CfoReportSchema>;
