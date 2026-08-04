import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LaunchProjectInput } from "@/lib/types";
import { createAssetRules } from "@/lib/asset-catalog";

export const LAUNCH_STEP_ORDER = [
  "project_name",
  "project_symbol",
  "description",
  "token_supply",
  "treasury_address",
  "reserve_target",
  "approved_assets",
  "revenue_routing",
  "max_single_asset",
  "max_crypto",
  "max_trade",
  "risk_approach",
  "reporting_frequency",
  "review",
] as const;

export type LaunchStep = (typeof LAUNCH_STEP_ORDER)[number] | "revenue_routing_custom";

export type LaunchDraftStatus = "in_progress" | "awaiting_signature" | "completed" | "abandoned";

export type LaunchDraftData = {
  projectName?: string;
  projectSymbol?: string;
  description?: string;
  tokenSupply?: number;
  treasuryAddress?: string;
  minimumReserve?: number;
  approvedAssets?: string[];
  revenueRouting?: string;
  maximumSingleAsset?: number;
  maximumCrypto?: number;
  maximumTrade?: number;
  riskApproach?: string;
  reportingFrequency?: string;
};

export type LaunchDraftRow = {
  id: string;
  chat_id: string;
  draft_token: string;
  step: LaunchStep;
  status: LaunchDraftStatus;
  data: LaunchDraftData;
  expires_at: string | null;
};

/** "revenue_routing_custom" is a side branch off revenue_routing, not part of the linear order — it rejoins at max_single_asset either way. */
export function nextStep(step: LaunchStep): LaunchStep {
  if (step === "revenue_routing_custom") return "max_single_asset";
  const index = LAUNCH_STEP_ORDER.indexOf(step as (typeof LAUNCH_STEP_ORDER)[number]);
  return LAUNCH_STEP_ORDER[Math.min(index + 1, LAUNCH_STEP_ORDER.length - 1)];
}

export function previousStep(step: LaunchStep): LaunchStep {
  if (step === "revenue_routing_custom") return "revenue_routing";
  const index = LAUNCH_STEP_ORDER.indexOf(step as (typeof LAUNCH_STEP_ORDER)[number]);
  return LAUNCH_STEP_ORDER[Math.max(index - 1, 0)];
}

export function generateDraftToken(): string {
  return randomBytes(16).toString("hex");
}

export async function getActiveDraft(supabase: SupabaseClient, chatId: string): Promise<LaunchDraftRow | null> {
  const { data } = await supabase
    .from("telegram_launch_drafts")
    .select("id, chat_id, draft_token, step, status, data, expires_at")
    .eq("chat_id", chatId)
    .eq("status", "in_progress")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as LaunchDraftRow) ?? null;
}

export async function createDraft(supabase: SupabaseClient, chatId: string): Promise<LaunchDraftRow> {
  const { data, error } = await supabase
    .from("telegram_launch_drafts")
    .insert({ chat_id: chatId, draft_token: generateDraftToken(), step: "project_name", status: "in_progress", data: {} })
    .select("id, chat_id, draft_token, step, status, data, expires_at")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to start a launch draft.");
  return data as LaunchDraftRow;
}

export async function updateDraft(supabase: SupabaseClient, draftId: string, patch: { step?: LaunchStep; data?: LaunchDraftData; status?: LaunchDraftStatus }): Promise<void> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.step) update.step = patch.step;
  if (patch.data) update.data = patch.data;
  if (patch.status) update.status = patch.status;
  const { error } = await supabase.from("telegram_launch_drafts").update(update).eq("id", draftId);
  if (error) throw new Error(error.message);
}

export async function abandonActiveDraft(supabase: SupabaseClient, chatId: string): Promise<void> {
  await supabase.from("telegram_launch_drafts").update({ status: "abandoned", updated_at: new Date().toISOString() }).eq("chat_id", chatId).eq("status", "in_progress");
}

/** Marks the draft ready for the wallet-sign handoff — the page that reads it back checks both status and this expiry, so a stale draft link can't be replayed indefinitely. */
export async function markAwaitingSignature(supabase: SupabaseClient, draftId: string): Promise<void> {
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from("telegram_launch_drafts")
    .update({ status: "awaiting_signature", expires_at: expiresAt, updated_at: new Date().toISOString() })
    .eq("id", draftId);
  if (error) throw new Error(error.message);
}

export async function getDraftByToken(supabase: SupabaseClient, token: string): Promise<LaunchDraftRow | null> {
  const { data } = await supabase
    .from("telegram_launch_drafts")
    .select("id, chat_id, draft_token, step, status, data, expires_at")
    .eq("draft_token", token)
    .maybeSingle();
  return (data as LaunchDraftRow) ?? null;
}

export async function markDraftCompleted(supabase: SupabaseClient, draftId: string): Promise<void> {
  const { error } = await supabase.from("telegram_launch_drafts").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", draftId);
  if (error) throw new Error(error.message);
}

/**
 * Maps the chat-collected answers onto the same LaunchProjectInput shape the
 * web wizard's form produces — nothing downstream (schema validation,
 * createProject, the deploy tx) needs to know this came from Telegram
 * instead of a form. Fields the chat flow doesn't ask about get the same
 * defaults the web wizard ships with.
 */
export function draftToLaunchInput(data: LaunchDraftData): LaunchProjectInput {
  const projectName = data.projectName ?? "";
  const projectSymbol = data.projectSymbol ?? "";
  const minimumReserve = data.minimumReserve ?? 60;
  return {
    projectName,
    projectSymbol,
    description: data.description ?? "",
    website: "",
    tokenName: `${projectName} Token`.trim(),
    tokenSymbol: projectSymbol,
    totalSupply: data.tokenSupply ?? 1_000_000_000,
    decimals: 18,
    initialReserve: 10_000,
    revenueRouting: data.revenueRouting ?? "100% to treasury",
    minimumReserve,
    maximumSingleAsset: data.maximumSingleAsset ?? 20,
    maximumCrypto: data.maximumCrypto ?? 15,
    maximumTrade: data.maximumTrade ?? 10,
    treasuryObjective: `Maintain a minimum ${minimumReserve}% reserve and grow ${projectName || "the"} treasury within a deterministic, policy-checked mandate.`,
    riskApproach: data.riskApproach ?? "Balanced",
    reportingFrequency: data.reportingFrequency ?? "Weekly",
    assetRules: createAssetRules(data.approvedAssets ?? [], data.maximumSingleAsset ?? 20),
    treasuryAddress: data.treasuryAddress,
  };
}
