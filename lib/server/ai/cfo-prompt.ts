import type { ActivityItem, AgentReport, Recommendation, TreasuryAssetRule, TreasuryPolicy, TreasuryPosition, TreasurySummary } from "@/lib/types";

export type CfoPromptInput = {
  projectName: string;
  treasuryObjective: string;
  summary: TreasurySummary | null;
  positions: TreasuryPosition[];
  activity: ActivityItem[];
  policy: TreasuryPolicy;
  previousReports: AgentReport[];
  openRecommendations: Recommendation[];
};

export const CFO_SYSTEM_PROMPT = `You are the Treasury Agent for a public, onchain treasury on Robinhood Chain. You act as a read-only financial analyst and advisor to the treasury's human operators — you are never authorised to hold keys, sign transactions, broadcast anything onchain, or bypass treasury policy in any way.

Your only output is a structured treasury health report with zero or more trade recommendations. A separate, deterministic policy engine — code you do not control and cannot see the internals of — independently validates every recommendation you propose against the treasury's actual policy limits before a human operator ever sees it as approvable. Nothing you say here is ever executed automatically, and nothing you say here overrides that policy engine; you can and should propose recommendations that the policy engine may reject, since your job is financial judgment, not compliance enforcement.

Ground every finding, warning, and recommendation only in the data provided to you below. Never invent balances, prices, transactions, or policy limits that are not present in the input. If the data is insufficient to form a judgment, say so in a finding or warning rather than guessing.

Recommendation guidance:
- Use "buy" to acquire more of an approved asset by spending USDG reserve.
- Use "sell" to convert an existing asset position back into USDG reserve.
- Use "rebalance" when the desired underlying action is still "into" an asset (increasing an approved asset's target allocation) — it is evaluated by the policy engine identically to "buy".
- Use "hold" when no trade is warranted right now; leave assetSymbol and amountUsd null.
- Set assetSymbol to the exact ticker symbol as given in the approved assets list.
- Set amountUsd to a specific proposed USD notional for buy/sell/rebalance — never a range.
- Set urgency based on how time-sensitive the recommendation is, not how large it is.
- Do not propose trades for assets that are not in the approved assets list.`;

export function formatBps(bps: number) {
  return `${(bps).toFixed(1)}%`;
}

export function formatPositions(positions: TreasuryPosition[]) {
  if (positions.length === 0) return "No positions recorded yet (treasury may be empty or unsynced).";
  return positions
    .map((p) => `- ${p.symbol} (${p.type}): balance ${p.balance}, price $${p.price.toLocaleString()}, value $${p.value.toLocaleString()}, allocation ${p.allocation.toFixed(1)}%, freshness ${p.freshness}`)
    .join("\n");
}

export function formatActivity(activity: ActivityItem[]) {
  const recent = activity.slice(0, 15);
  if (recent.length === 0) return "No recent onchain activity recorded.";
  return recent.map((a) => `- ${a.time} · ${a.type} · ${a.asset} ${a.amount} (${a.usdValue}) · ${a.status}`).join("\n");
}

export function formatAssetRules(rules: TreasuryAssetRule[]) {
  const approved = rules.filter((r) => r.approved);
  if (approved.length === 0) return "No assets are currently approved for trading.";
  return approved
    .map((r) => `- ${r.symbol} (${r.type}): max allocation ${r.maxAllocation.toFixed(1)}%, max single purchase $${r.maxSinglePurchaseUsd.toLocaleString()}, agent may recommend: ${r.agentMayRecommend ? "yes" : "no"}`)
    .join("\n");
}

function formatPreviousReports(reports: AgentReport[]) {
  const recent = reports.slice(0, 2);
  if (recent.length === 0) return "No previous Treasury Agent reports.";
  return recent.map((r) => `- ${r.createdAt} (${r.health}): ${r.summary}`).join("\n");
}

function formatOpenRecommendations(recommendations: Recommendation[]) {
  const open = recommendations.filter((r) => r.status === "Pending");
  if (open.length === 0) return "No open recommendations awaiting a decision.";
  return open.map((r) => `- ${r.title}: ${r.action} ${r.amount} (${r.fromAsset} -> ${r.toAsset}), proposed ${r.createdAt}`).join("\n");
}

export function buildCfoUserContent(input: CfoPromptInput): string {
  const { summary, policy } = input;
  return `# Treasury: ${input.projectName}

## Objective
${input.treasuryObjective}

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
- Maximum single trade size: ${formatBps(policy.maximumTrade)} of NAV — applies only to BUY/REBALANCE trades that take on new exposure. A SELL or BUILD_RESERVES trade (reducing an existing position, converting back to USDG) is NOT subject to this cap, since it can only improve reserve/allocation/crypto-exposure ratios, never worsen them. Do not treat a reserve-building sell as blocked by this limit.
- Human approval required: ${policy.humanApproval ? "yes" : "no"}
- Automated execution allowed: ${policy.automatedExecution ? "yes" : "no"}

## Approved assets
${formatAssetRules(policy.assetRules)}

## Recent onchain activity (most recent first)
${formatActivity(input.activity)}

## Previous Treasury Agent reports
${formatPreviousReports(input.previousReports)}

## Open recommendations already awaiting operator review
${formatOpenRecommendations(input.openRecommendations)}

Produce your treasury health report and recommendations now, grounded strictly in the data above.`;
}
