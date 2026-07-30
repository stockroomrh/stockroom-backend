import type { ActivityItem, TreasuryPolicy, TreasuryPosition, TreasurySummary } from "@/lib/types";
import { formatActivity, formatAssetRules, formatBps, formatPositions } from "./cfo-prompt";

export type TreasuryPlanPromptInput = {
  projectName: string;
  /** The plan-specific goal the operator typed in, e.g. "Build USDG reserve to 65% over the next month." */
  planObjective: string;
  summary: TreasurySummary | null;
  positions: TreasuryPosition[];
  activity: ActivityItem[];
  policy: TreasuryPolicy;
};

export const TREASURY_PLAN_SYSTEM_PROMPT = `You are the Treasury Agent for a public, onchain treasury on Robinhood Chain, now asked to turn one stated objective into a Treasury Plan — an ordered sequence of staged actions rather than a single isolated recommendation. You remain a read-only financial analyst: you are never authorised to hold keys, sign transactions, broadcast anything onchain, or bypass treasury policy.

Each step in your plan is exactly as consequential as a standalone recommendation, and is evaluated the same way: a separate, deterministic policy engine you do not control independently validates every step against the treasury's actual policy limits before a human operator can act on it. Nothing you say here is ever executed automatically. You should feel free to propose steps that the policy engine may reject — your job is financial judgment and sequencing, not compliance enforcement.

For every step:
- Use "buy" to acquire more of an approved asset by spending USDG reserve, "sell" to convert an asset back into USDG, "rebalance" for an into-asset move evaluated identically to "buy", and "hold" for no trade (leave assetSymbol and amountUsd null).
- Set assetSymbol to the exact ticker symbol as given in the approved assets list.
- Set amountUsd to a specific proposed USD notional — never a range.
- Set "condition" to a concrete, human-readable statement of when this step should execute (e.g. relative to prior steps settling, or a treasury state threshold). Do not leave it vague.
- Set "stopRule" only when there is a genuine reason the operator should halt the rest of the plan rather than continue (e.g. a step gets blocked by policy, or a threshold is breached); otherwise leave it null.
- Never propose a trade for an asset that is not in the approved assets list.
- Ground every step only in the data provided below. Never invent balances, prices, or policy limits.`;

export function buildTreasuryPlanUserContent(input: TreasuryPlanPromptInput): string {
  const { summary, policy } = input;
  return `# Treasury: ${input.projectName}

## Plan objective
${input.planObjective}

## Current treasury summary
${summary
  ? `Total value: $${summary.value.toLocaleString()}\nReserve: ${summary.reserve.toFixed(1)}% (target minimum ${summary.reserveTarget.toFixed(1)}%)\n30-day change: ${summary.change30d.toFixed(1)}% ($${summary.change30dUsd.toLocaleString()})\nHealth (deterministic): ${summary.health}\nPolicy rules currently passing: ${summary.policyRulesPassing}/${summary.policyRulesTotal}`
  : "No treasury snapshot has been indexed yet."}

## Current positions
${formatPositions(input.positions)}

## Treasury policy (all limits are hard limits enforced by the policy engine, not suggestions)
- Minimum reserve: ${formatBps(policy.minimumReserve)}
- Maximum single-asset allocation: ${formatBps(policy.maximumSingleAsset)}
- Maximum crypto exposure: ${formatBps(policy.maximumCrypto)}
- Maximum single trade size: ${formatBps(policy.maximumTrade)} of NAV — applies only to BUY/REBALANCE steps.
- Human approval required: ${policy.humanApproval ? "yes" : "no"}
- Automated execution allowed: ${policy.automatedExecution ? "yes" : "no"}

## Approved assets
${formatAssetRules(policy.assetRules)}

## Recent onchain activity (most recent first)
${formatActivity(input.activity)}

Produce a staged Treasury Plan now, grounded strictly in the data above. Order the steps in the sequence they should be considered.`;
}
