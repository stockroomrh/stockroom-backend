import type { ActivityItem, Recommendation, TreasuryPolicy, TreasuryPosition, TreasurySummary } from "@/lib/types";
import { formatActivity, formatAssetRules, formatBps, formatPositions } from "./cfo-prompt";

export type TelegramQaPromptInput = {
  projectName: string;
  question: string;
  summary: TreasurySummary | null;
  positions: TreasuryPosition[];
  activity: ActivityItem[];
  policy: TreasuryPolicy;
  openRecommendations: Recommendation[];
};

export const TELEGRAM_QA_SYSTEM_PROMPT = `You are the Treasury Agent for a public, onchain treasury, answering an operator's question inside Telegram. You are a read-only financial analyst — you are never authorised to hold keys, sign transactions, broadcast anything onchain, or bypass treasury policy in any way, and you cannot execute anything from this conversation.

Ground every answer only in the data provided below. Never invent balances, prices, transactions, or policy limits that are not present in the input. If the data is insufficient to answer confidently, say so plainly rather than guessing.

Answer in plain conversational text (2-5 short sentences, or a short list if that's clearer) — this is a chat message, not a structured report. No markdown headers, no JSON. Be direct and specific with real numbers from the data provided. If the question implies a trade or spending decision, remind the reader that any actual action still requires an authorised human wallet signature and independent policy validation — but don't belabor this if the question is purely informational.`;

function formatOpenRecommendations(recommendations: Recommendation[]) {
  const open = recommendations.filter((r) => r.status === "Pending");
  if (open.length === 0) return "No open recommendations awaiting a decision.";
  return open.map((r) => `- ${r.title}: ${r.action} ${r.amount} (${r.fromAsset} -> ${r.toAsset}), policy result: ${r.policyResult}`).join("\n");
}

export function buildTelegramQaUserContent(input: TelegramQaPromptInput): string {
  const { summary, policy } = input;
  return `# Treasury: ${input.projectName}

## Current treasury summary
${summary
  ? `Total value: $${summary.value.toLocaleString()}\nReserve: ${summary.reserve.toFixed(1)}% (target minimum ${summary.reserveTarget.toFixed(1)}%)\n30-day change: ${summary.change30d.toFixed(1)}% ($${summary.change30dUsd.toLocaleString()})\nHealth (deterministic): ${summary.health}\nPolicy rules currently passing: ${summary.policyRulesPassing}/${summary.policyRulesTotal}`
  : "No treasury snapshot has been indexed yet."}

## Current positions
${formatPositions(input.positions)}

## Treasury policy (hard limits, not suggestions)
- Minimum reserve: ${formatBps(policy.minimumReserve)}
- Maximum single-asset allocation: ${formatBps(policy.maximumSingleAsset)}
- Maximum crypto exposure: ${formatBps(policy.maximumCrypto)}
- Maximum single trade size: ${formatBps(policy.maximumTrade)} of NAV
- Human approval required: ${policy.humanApproval ? "yes" : "no"}

## Approved assets
${formatAssetRules(policy.assetRules)}

## Recent onchain activity (most recent first)
${formatActivity(input.activity)}

## Open recommendations awaiting operator review
${formatOpenRecommendations(input.openRecommendations)}

## Operator's question
${input.question}

Answer the question above now, grounded strictly in the data given.`;
}
