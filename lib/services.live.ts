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
import { flagshipProjectSlug } from "./mode";

async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  if (response.status === 404) return null as T;
  if (!response.ok) throw new Error(`Live request failed: GET ${path} (${response.status})`);
  return (await response.json()) as T;
}

async function apiSend<T>(path: string, method: "POST" | "PATCH", body: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}) as { error?: string });
    throw new Error(detail.error ?? `Live request failed: ${method} ${path} (${response.status})`);
  }
  return (await response.json()) as T;
}

// Live mode only ever shows the flagship project — the underlying database is
// multi-project-capable, but a permissionless public creator is out of scope
// for launch (see docs/PRODUCT_BRIEF.md §5, §26).
export async function getProjects(): Promise<Project[]> {
  return apiGet<Project[]>("/api/projects");
}

export async function getProjectBySlug(slug: string): Promise<Project | null> {
  return apiGet<Project | null>(`/api/projects/${slug}`);
}

export async function getProjectBundle(slug: string): Promise<ProjectBundle | null> {
  return apiGet<ProjectBundle | null>(`/api/projects/${slug}/bundle`);
}

export async function getTreasurySummary(slug: string = flagshipProjectSlug()): Promise<TreasurySummary | null> {
  return apiGet<TreasurySummary | null>(`/api/projects/${slug}/treasury/summary`);
}

export async function getTreasuryHistory(slug: string = flagshipProjectSlug()): Promise<TreasurySnapshot[]> {
  return apiGet<TreasurySnapshot[]>(`/api/projects/${slug}/treasury/history`);
}

export async function getPositions(slug: string = flagshipProjectSlug()): Promise<TreasuryPosition[]> {
  return apiGet<TreasuryPosition[]>(`/api/projects/${slug}/treasury/positions`);
}

export async function getProjectAsset(slug: string, symbol: string): Promise<TreasuryPosition | null> {
  const positions = await getPositions(slug);
  return positions.find((item) => item.symbol.toLowerCase() === symbol.toLowerCase()) ?? null;
}

export async function getActivity(slug: string = flagshipProjectSlug()): Promise<ActivityItem[]> {
  return apiGet<ActivityItem[]>(`/api/projects/${slug}/activity`);
}

export async function getPolicy(slug: string = flagshipProjectSlug()): Promise<TreasuryPolicy | null> {
  return apiGet<TreasuryPolicy | null>(`/api/projects/${slug}/policy`);
}

export async function getAgentReports(slug: string = flagshipProjectSlug()): Promise<AgentReport[]> {
  return apiGet<AgentReport[]>(`/api/projects/${slug}/agent/reports`);
}

export async function getRecommendations(slug: string = flagshipProjectSlug()): Promise<Recommendation[]> {
  return apiGet<Recommendation[]>(`/api/projects/${slug}/recommendations`);
}

type LiveUserProject = UserProject & { project: Project; summary: TreasurySummary | null; latestActivity: ActivityItem | null };

export async function getUserProjects(): Promise<LiveUserProject[]> {
  const response = await fetch("/api/projects/mine", { cache: "no-store" });
  // Not signed in yet — treat as "no projects" rather than an error; the
  // wallet sign-in control is always visible in the app header.
  if (response.status === 401) return [];
  if (!response.ok) throw new Error(`Live request failed: GET /api/projects/mine (${response.status})`);
  return (await response.json()) as LiveUserProject[];
}

export async function createLiveProject(input: LaunchProjectInput): Promise<ProjectBundle> {
  return apiSend<ProjectBundle>("/api/projects", "POST", input);
}

export async function updateProjectAssetRules(slug: string, assetRules: TreasuryAssetRule[]): Promise<ProjectBundle | null> {
  return apiSend<ProjectBundle | null>(`/api/projects/${slug}/assets`, "PATCH", { assetRules });
}

export async function requestLiveTradeQuote(recommendation: Recommendation): Promise<TradeQuote> {
  return apiSend<TradeQuote>("/api/trade/quote", "POST", { recommendationId: recommendation.id });
}

// Runs one Treasury Agent cycle (real data -> AI report -> policy-checked
// recommendations, all stored server-side) and returns the fully refreshed
// bundle. No trade is executed — that's Stage 5.
export async function generateAgentReport(slug: string): Promise<ProjectBundle | null> {
  return apiSend<ProjectBundle | null>(`/api/projects/${slug}/agent/generate`, "POST", {});
}

export async function setRecommendationStatus(slug: string, recommendationId: string, status: "approved" | "rejected"): Promise<Recommendation> {
  return apiSend<Recommendation>(`/api/projects/${slug}/recommendations/${recommendationId}`, "PATCH", { status });
}

export async function getTreasuryPlans(slug: string): Promise<TreasuryPlan[]> {
  return apiGet<TreasuryPlan[]>(`/api/projects/${slug}/plans`);
}

// Runs one Treasury Plan generation cycle for a stated objective (real data
// -> staged Agent plan -> every step independently policy-checked and
// stored). No trade is executed — approving/executing a step reuses the
// existing recommendation quote/execute flow untouched.
export async function generateTreasuryPlan(slug: string, objective: string): Promise<TreasuryPlan> {
  return apiSend<TreasuryPlan>(`/api/projects/${slug}/plans`, "POST", { objective });
}

export async function setTreasuryPlanPaused(slug: string, planId: string, paused: boolean): Promise<TreasuryPlan> {
  return apiSend<TreasuryPlan>(`/api/projects/${slug}/plans/${planId}/pause`, "POST", { resume: !paused });
}

export async function regenerateTreasuryPlan(slug: string, planId: string): Promise<TreasuryPlan> {
  return apiSend<TreasuryPlan>(`/api/projects/${slug}/plans/${planId}/regenerate`, "POST", {});
}

// A plan step IS a recommendation row underneath, so approving/rejecting one
// reuses the existing recommendations PATCH route unchanged, then refetches
// the plan so the UI sees the step's updated status in place.
export async function setPlanStepStatus(slug: string, planId: string, recommendationId: string, status: "approved" | "rejected"): Promise<TreasuryPlan> {
  await apiSend<Recommendation>(`/api/projects/${slug}/recommendations/${recommendationId}`, "PATCH", { status });
  return apiGet<TreasuryPlan>(`/api/projects/${slug}/plans/${planId}`);
}
