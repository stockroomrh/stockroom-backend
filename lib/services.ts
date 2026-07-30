// Mode-aware dispatcher. This is the ONLY file that should change when a
// function graduates from Preview (mock, lib/services.preview.ts) to Live
// (real backend, lib/services.live.ts) — every calling component keeps using
// these exact exports with an unchanged contract. See CLAUDE_HANDOFF.md and
// docs/BACKEND_STAGE0_AUDIT.md.
import { getMode } from "./mode";
import * as preview from "./services.preview";
import * as live from "./services.live";
import type {
  ActivityItem,
  AgentReport,
  LaunchProjectInput,
  Project,
  ProjectBundle,
  Recommendation,
  TradeQuote,
  TreasuryAssetRule,
  TreasuryPlan,
  TreasuryPolicy,
  TreasuryPosition,
  TreasurySnapshot,
  TreasurySummary,
  UserProject,
} from "./types";

export const subscribeProjectStore = preview.subscribeProjectStore;
export const resetLocalProjects = preview.resetLocalProjects;

export async function getProjects(): Promise<Project[]> {
  return getMode() === "live" ? live.getProjects() : preview.getProjects();
}

export async function getProjectBySlug(slug: string): Promise<Project | null> {
  return getMode() === "live" ? live.getProjectBySlug(slug) : preview.getProjectBySlug(slug);
}

export async function getProjectBundle(slug: string): Promise<ProjectBundle | null> {
  return getMode() === "live" ? live.getProjectBundle(slug) : preview.getProjectBundle(slug);
}

export async function getTreasurySummary(slug?: string): Promise<TreasurySummary | null> {
  return getMode() === "live" ? live.getTreasurySummary(slug) : preview.getTreasurySummary(slug);
}

export async function getTreasuryHistory(slug?: string): Promise<TreasurySnapshot[]> {
  return getMode() === "live" ? live.getTreasuryHistory(slug) : preview.getTreasuryHistory(slug);
}

export async function getPositions(slug?: string): Promise<TreasuryPosition[]> {
  return getMode() === "live" ? live.getPositions(slug) : preview.getPositions(slug);
}

export async function getProjectAsset(slug: string, symbol: string): Promise<TreasuryPosition | null> {
  return getMode() === "live" ? live.getProjectAsset(slug, symbol) : preview.getProjectAsset(slug, symbol);
}

export async function getActivity(slug?: string): Promise<ActivityItem[]> {
  return getMode() === "live" ? live.getActivity(slug) : preview.getActivity(slug);
}

export async function getPolicy(slug?: string): Promise<TreasuryPolicy | null> {
  return getMode() === "live" ? live.getPolicy(slug) : preview.getPolicy(slug);
}

export async function getAgentReports(slug?: string): Promise<AgentReport[]> {
  return getMode() === "live" ? live.getAgentReports(slug) : preview.getAgentReports(slug);
}

export async function getRecommendations(slug?: string): Promise<Recommendation[]> {
  return getMode() === "live" ? live.getRecommendations(slug) : preview.getRecommendations(slug);
}

export async function getUserProjects(): Promise<(UserProject & { project: Project; summary: TreasurySummary | null; latestActivity: ActivityItem | null })[]> {
  return getMode() === "live" ? live.getUserProjects() : preview.getUserProjects();
}

export async function createLocalProject(input: LaunchProjectInput): Promise<ProjectBundle> {
  return getMode() === "live" ? live.createLiveProject(input) : preview.createLocalProject(input);
}

export async function requestMockTradeQuote(recommendation: Recommendation): Promise<TradeQuote> {
  return getMode() === "live" ? live.requestLiveTradeQuote(recommendation) : preview.requestMockTradeQuote(recommendation);
}

export async function updateProjectAssetRules(slug: string, assetRules: TreasuryAssetRule[]): Promise<ProjectBundle | null> {
  return getMode() === "live" ? live.updateProjectAssetRules(slug, assetRules) : preview.updateProjectAssetRules(slug, assetRules);
}

export async function generateAgentReport(slug: string): Promise<ProjectBundle | null> {
  return getMode() === "live" ? live.generateAgentReport(slug) : preview.generateAgentReport(slug);
}

export async function setRecommendationStatus(slug: string, recommendationId: string, status: "approved" | "rejected"): Promise<Recommendation | null> {
  return getMode() === "live" ? live.setRecommendationStatus(slug, recommendationId, status) : preview.setRecommendationStatus(slug, recommendationId, status);
}

export async function getTreasuryPlans(slug: string): Promise<TreasuryPlan[]> {
  return getMode() === "live" ? live.getTreasuryPlans(slug) : preview.getTreasuryPlans(slug);
}

export async function generateTreasuryPlan(slug: string, objective: string): Promise<TreasuryPlan> {
  return getMode() === "live" ? live.generateTreasuryPlan(slug, objective) : preview.generateTreasuryPlan(slug, objective);
}

export async function setTreasuryPlanPaused(slug: string, planId: string, paused: boolean): Promise<TreasuryPlan> {
  return getMode() === "live" ? live.setTreasuryPlanPaused(slug, planId, paused) : preview.setTreasuryPlanPaused(slug, planId, paused);
}

export async function regenerateTreasuryPlan(slug: string, planId: string): Promise<TreasuryPlan> {
  return getMode() === "live" ? live.regenerateTreasuryPlan(slug, planId) : preview.regenerateTreasuryPlan(slug, planId);
}

export async function setPlanStepStatus(slug: string, planId: string, recommendationId: string, status: "approved" | "rejected"): Promise<TreasuryPlan> {
  return getMode() === "live" ? live.setPlanStepStatus(slug, planId, recommendationId, status) : preview.setPlanStepStatus(slug, planId, recommendationId, status);
}
