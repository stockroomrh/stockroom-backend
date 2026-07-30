import { builtInProjectBundles, defaultProjectSlug } from "./mock-data";
import { approvedAssetSymbols, createAssetRules } from "./asset-catalog";
import {
  AgentReportSchema,
  ProjectSchema,
  RecommendationSchema,
  TreasuryPolicySchema,
  TreasuryPositionSchema,
  TreasurySnapshotSchema,
  TreasurySummarySchema,
} from "./schemas";
import type {
  LaunchProjectInput,
  PlanStep,
  Project,
  ProjectBundle,
  Recommendation,
  TradeQuote,
  TreasuryPlan,
  TreasuryPosition,
  TreasuryAssetRule,
} from "./types";

const STORAGE_KEY = "stockroom:local-projects:v1";
const STORE_EVENT = "stockroom-projects-updated";
const wait = (ms = 70) => new Promise((resolve) => setTimeout(resolve, ms));

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || `project-${Date.now()}`;
}

function address(seed: string) {
  const encoded = Array.from(seed).map((char) => char.charCodeAt(0).toString(16)).join("");
  return `0x${(encoded + "1234567890abcdef".repeat(4)).slice(0, 40)}`;
}

function readLocalBundles(): ProjectBundle[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ProjectBundle[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((bundle) => ({
      ...bundle,
      policy: {
        ...bundle.policy,
        assetRules: bundle.policy.assetRules ?? createAssetRules(bundle.policy.approvedAssets, bundle.policy.maximumSingleAsset),
      },
    }));
  } catch {
    return [];
  }
}

function writeLocalBundles(bundles: ProjectBundle[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bundles));
  window.dispatchEvent(new Event(STORE_EVENT));
}

function bundles(): ProjectBundle[] {
  const local = readLocalBundles();
  const localSlugs = new Set(local.map((bundle) => bundle.project.slug));
  return [...local, ...builtInProjectBundles.filter((bundle) => !localSlugs.has(bundle.project.slug))];
}

function findBundle(slug = defaultProjectSlug) {
  return bundles().find((bundle) => bundle.project.slug === slug) ?? null;
}

export function subscribeProjectStore(callback: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => callback();
  window.addEventListener(STORE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(STORE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export async function getProjects(): Promise<Project[]> {
  await wait();
  return bundles().map((bundle) => ProjectSchema.parse(bundle.project));
}

export async function getProjectBySlug(slug: string): Promise<Project | null> {
  await wait();
  const bundle = findBundle(slug);
  return bundle ? ProjectSchema.parse(bundle.project) : null;
}

export async function getProjectBundle(slug: string): Promise<ProjectBundle | null> {
  await wait();
  const bundle = findBundle(slug);
  if (!bundle) return null;
  return {
    ...bundle,
    project: ProjectSchema.parse(bundle.project),
    summary: TreasurySummarySchema.parse(bundle.summary),
    history: bundle.history.map((item) => TreasurySnapshotSchema.parse(item)),
    positions: bundle.positions.map((item) => TreasuryPositionSchema.parse(item)),
    policy: TreasuryPolicySchema.parse(bundle.policy),
    reports: bundle.reports.map((item) => AgentReportSchema.parse(item)),
    recommendations: bundle.recommendations.map((item) => RecommendationSchema.parse(item)),
  };
}

export async function getTreasurySummary(slug = defaultProjectSlug) {
  await wait();
  const bundle = findBundle(slug);
  return bundle ? TreasurySummarySchema.parse(bundle.summary) : null;
}

export async function getTreasuryHistory(slug = defaultProjectSlug) {
  await wait();
  const bundle = findBundle(slug);
  return bundle ? bundle.history.map((item) => TreasurySnapshotSchema.parse(item)) : [];
}

export async function getPositions(slug = defaultProjectSlug) {
  await wait();
  const bundle = findBundle(slug);
  return bundle ? bundle.positions.map((item) => TreasuryPositionSchema.parse(item)) : [];
}

export async function getProjectAsset(slug: string, symbol: string): Promise<TreasuryPosition | null> {
  const positions = await getPositions(slug);
  return positions.find((item) => item.symbol.toLowerCase() === symbol.toLowerCase()) ?? null;
}

export async function getActivity(slug = defaultProjectSlug) {
  await wait();
  return findBundle(slug)?.activity ?? [];
}

export async function getPolicy(slug = defaultProjectSlug) {
  await wait();
  const bundle = findBundle(slug);
  return bundle ? TreasuryPolicySchema.parse(bundle.policy) : null;
}

export async function getAgentReports(slug = defaultProjectSlug) {
  await wait();
  const bundle = findBundle(slug);
  return bundle ? bundle.reports.map((item) => AgentReportSchema.parse(item)) : [];
}

export async function getRecommendations(slug = defaultProjectSlug) {
  await wait();
  const bundle = findBundle(slug);
  return bundle ? bundle.recommendations.map((item) => RecommendationSchema.parse(item)) : [];
}

export async function getUserProjects() {
  await wait();
  return bundles().filter((bundle) => bundle.userProject.role !== "Viewer").map((bundle) => ({
    ...bundle.userProject,
    project: bundle.project,
    summary: bundle.summary,
    latestActivity: bundle.activity[0] ?? null,
  }));
}

export async function createLocalProject(input: LaunchProjectInput): Promise<ProjectBundle> {
  await wait(180);
  const baseSlug = slugify(input.projectName);
  const existing = new Set(bundles().map((bundle) => bundle.project.slug));
  let slug = baseSlug;
  let suffix = 2;
  while (existing.has(slug)) slug = `${baseSlug}-${suffix++}`;

  const ticker = input.projectSymbol.toUpperCase().slice(0, 8);
  const value = Math.max(input.initialReserve, 1000);
  const reserveValue = value;
  const project: Project = {
    id: `local-${Date.now()}`,
    slug,
    name: input.projectName,
    ticker,
    description: input.description,
    shortDescription: input.description.slice(0, 90),
    logoText: input.projectName.slice(0, 1).toUpperCase(),
    accent: "#d9ff00",
    creatorWallet: address(`${slug}-creator`),
    treasuryAddress: address(`${slug}-treasury`),
    treasuryObjective: input.treasuryObjective,
    launchDate: new Intl.DateTimeFormat("en-US", { month: "long", day: "2-digit", year: "numeric" }).format(new Date()),
    featured: false,
    trendingScore: 50,
    socials: { website: input.website || undefined },
    token: {
      name: input.tokenName,
      symbol: input.tokenSymbol.toUpperCase(),
      price: 0.01,
      marketCap: input.totalSupply * 0.01,
      totalSupply: input.totalSupply,
      circulatingSupply: Math.round(input.totalSupply * 0.48),
      holderCount: 1,
      liquidity: Math.round(value * 0.2),
      decimals: input.decimals,
      contract: address(`${slug}-token`),
      launchTx: address(`${slug}-launch`),
      deploymentDate: new Intl.DateTimeFormat("en-US", { month: "long", day: "2-digit", year: "numeric" }).format(new Date()),
      distribution: [
        { label: "Community", percentage: 55 },
        { label: "Liquidity", percentage: 20 },
        { label: "Treasury", percentage: 15 },
        { label: "Team", percentage: 10 },
      ],
    },
  };

  const position: TreasuryPosition = {
    symbol: "USDG", name: "Global Dollar", type: "Stablecoin", balance: reserveValue.toFixed(2), price: 1,
    value: reserveValue, allocation: 100, change24h: 0, freshness: "Live", contract: address("USDG"),
    contractUrl: `https://explorer.testnet.robinhood.com/address/${address("USDG")}`, priceSource: "USDG reference feed",
    multiplier: 1, averageAcquisitionPrice: 1,
    recentTrades: [{ id: `${slug}-seed`, date: project.launchDate, side: "Buy", amount: `$${reserveValue.toLocaleString()}`, value: reserveValue }],
  };

  const recommendation: Recommendation = {
    id: `${slug}-recommendation-1`, projectSlug: slug, title: "Establish the first target allocation", amount: "$0.00",
    amountUsd: 0, status: "Pending", rationale: "The treasury currently holds its complete balance in USDG. Review approved assets before the first allocation.",
    action: "Review the active policy and select the first approved allocation.", fromAsset: "USDG", toAsset: "Pending selection",
    policyResult: "Human approval", policyChecks: [], createdAt: "Just now",
  };

  const bundle: ProjectBundle = {
    project,
    summary: { value, reserve: 100, reserveTarget: input.minimumReserve, change30d: 0, change30dUsd: 0, runway: 12, revenue30d: 0, expenses30d: 0, deposits30d: value, withdrawals30d: 0, updated: "Just now", health: "HEALTHY", chainStatus: "Live", policyRulesPassing: 8, policyRulesTotal: 8 },
    history: [{ date: "Launch", value }],
    positions: [position],
    activity: [{ id: `${slug}-launch`, time: "Just now", timestamp: new Date().toISOString(), type: "Deposit", description: "Mock initial treasury reserve", asset: "USDG", amount: `+${value.toLocaleString()}`, usdValue: `$${value.toLocaleString()}`, status: "Confirmed", blockscoutUrl: `https://explorer.testnet.robinhood.com/tx/${address(`${slug}-launch`)}` }],
    policy: { version: "1.0", minimumReserve: input.minimumReserve, maximumSingleAsset: input.maximumSingleAsset, maximumCrypto: input.maximumCrypto, maximumTrade: input.maximumTrade, humanApproval: true, automatedExecution: false, approvedAssets: approvedAssetSymbols(input.assetRules), assetRules: input.assetRules, updatedAt: project.launchDate, history: [{ version: "1.0", date: project.launchDate, summary: "Initial policy and supported assets created during the mock launch flow." }] },
    reports: [{ id: `${slug}-report-1`, createdAt: "Just now", health: "HEALTHY", title: "Launch treasury baseline", summary: "The Treasury Agent has established the initial public balance-sheet baseline. The treasury is fully reserved in USDG and no trade has been executed.", findings: ["Initial reserve recorded.", "All assets match the approved list.", `Reporting frequency set to ${input.reportingFrequency}.`], warnings: [], policyValidation: "Initial policy validation passed. Human approval remains required." }],
    recommendations: [recommendation],
    userProject: { projectSlug: slug, role: "Owner", operationalStatus: "Live", pendingRecommendations: 1 },
  };

  const local = readLocalBundles();
  writeLocalBundles([bundle, ...local]);
  return bundle;
}

export async function requestMockTradeQuote(recommendation: Recommendation): Promise<TradeQuote> {
  await wait(350);
  return {
    id: `quote-${recommendation.id}`,
    recommendationId: recommendation.id,
    inputAsset: recommendation.fromAsset,
    outputAsset: recommendation.toAsset,
    inputAmount: recommendation.amount,
    expectedOutput: recommendation.toAsset === "USDG" ? `${recommendation.amountUsd.toLocaleString()} USDG` : `${(recommendation.amountUsd / 180).toFixed(3)} ${recommendation.toAsset}`,
    priceImpact: recommendation.toAsset === "USDG" ? 0 : 0.18,
    feesUsd: Math.max(1.2, recommendation.amountUsd * 0.0015),
    network: "Robinhood Chain",
    expiresAt: "60 seconds",
  };
}

export function resetLocalProjects() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(STORE_EVENT));
}


export async function updateProjectAssetRules(slug: string, assetRules: TreasuryAssetRule[]): Promise<ProjectBundle | null> {
  await wait(120);
  const current = findBundle(slug);
  if (!current) return null;
  const nextVersion = (() => {
    const value = Number.parseFloat(current.policy.version);
    return Number.isFinite(value) ? (value + 0.1).toFixed(1) : current.policy.version;
  })();
  const updated: ProjectBundle = {
    ...current,
    policy: {
      ...current.policy,
      version: nextVersion,
      approvedAssets: approvedAssetSymbols(assetRules),
      assetRules,
      updatedAt: new Intl.DateTimeFormat("en-US", { month: "long", day: "2-digit", year: "numeric" }).format(new Date()),
      history: [
        { version: nextVersion, date: "Just now", summary: "Updated supported assets and Agent recommendation permissions." },
        ...current.policy.history,
      ],
    },
  };
  const local = readLocalBundles().filter((bundle) => bundle.project.slug !== slug);
  writeLocalBundles([updated, ...local]);
  return updated;
}

// Preview mode has no real AI model behind it — this returns the bundle
// unchanged rather than fabricating a new report under a "Live" premise.
export async function generateAgentReport(slug: string): Promise<ProjectBundle | null> {
  await wait(120);
  return findBundle(slug);
}

export async function setRecommendationStatus(slug: string, recommendationId: string, status: "approved" | "rejected"): Promise<Recommendation | null> {
  await wait(120);
  const current = findBundle(slug);
  if (!current) return null;
  const nextStatus = status === "approved" ? "Approved" : "Rejected";
  let updatedRecommendation: Recommendation | null = null;
  const recommendations = current.recommendations.map((item) => {
    if (item.id !== recommendationId) return item;
    updatedRecommendation = { ...item, status: nextStatus };
    return updatedRecommendation;
  });
  if (!updatedRecommendation) return null;
  const updated: ProjectBundle = { ...current, recommendations };
  const local = readLocalBundles().filter((bundle) => bundle.project.slug !== slug);
  writeLocalBundles([updated, ...local]);
  return updatedRecommendation;
}

// Treasury Plans live in their own local-storage bucket rather than on
// ProjectBundle — every existing bundle consumer keeps an unchanged contract.
const PLANS_STORAGE_KEY = "stockroom:local-plans:v1";
let mockPlanCounter = 0;

function readLocalPlans(): Record<string, TreasuryPlan[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PLANS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, TreasuryPlan[]>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalPlans(plans: Record<string, TreasuryPlan[]>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PLANS_STORAGE_KEY, JSON.stringify(plans));
  window.dispatchEvent(new Event(STORE_EVENT));
}

export async function getTreasuryPlans(slug: string): Promise<TreasuryPlan[]> {
  await wait();
  return readLocalPlans()[slug] ?? [];
}

// Preview mode has no real AI model or policy-evaluated recommendations
// backing it, so this builds a small, realistic plan from the project's OWN
// asset rules — one clean step, one within-limits buy, and (when the
// project's asset rules make it possible) one step that genuinely fails
// policy, the same way a live-mode plan would surface a real block.
function buildMockPlan(slug: string, objective: string, assetRules: TreasuryAssetRule[]): TreasuryPlan {
  const idBase = `plan-preview-${Date.now()}-${mockPlanCounter++}`;
  const approvedRule = assetRules.find((rule) => rule.approved && rule.agentMayRecommend);
  const blockedRule =
    assetRules.find((rule) => !rule.approved) ??
    assetRules.find((rule) => rule.approved && (!rule.agentMayRecommend || rule.maxSinglePurchaseUsd > 0));

  const steps: PlanStep[] = [
    {
      id: `${idBase}-step-0`,
      order: 0,
      condition: "Execute first — confirm current reserve health before any new purchase.",
      stopRule: null,
      recommendation: {
        id: `${idBase}-rec-0`,
        projectSlug: slug,
        title: "Hold — no action recommended",
        amount: "$0.00",
        amountUsd: 0,
        status: "Pending",
        rationale: `Baseline check before acting on: ${objective}`,
        action: "HOLD",
        fromAsset: "—",
        toAsset: "—",
        policyResult: "Pass",
        policyChecks: [
          { name: "trading_not_paused", passed: true, reason: "Trading is active." },
          { name: "not_expired", passed: true, reason: "Recommendation is within its validity window." },
        ],
        createdAt: "Just now",
      },
    },
  ];

  if (approvedRule) {
    const amountUsd = approvedRule.maxSinglePurchaseUsd > 0 ? Math.min(approvedRule.maxSinglePurchaseUsd, 1000) : 1000;
    steps.push({
      id: `${idBase}-step-1`,
      order: steps.length,
      condition: `Execute once step 1 is confirmed and ${approvedRule.symbol} remains within its approved allocation.`,
      stopRule: null,
      recommendation: {
        id: `${idBase}-rec-1`,
        projectSlug: slug,
        title: `Increase ${approvedRule.symbol} position`,
        amount: `$${amountUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        amountUsd,
        status: "Pending",
        rationale: `Move toward the stated objective by increasing the approved ${approvedRule.symbol} position.`,
        action: "BUY",
        fromAsset: "USDG",
        toAsset: approvedRule.symbol,
        policyResult: "Pass",
        policyChecks: [
          { name: "trading_not_paused", passed: true, reason: "Trading is active." },
          { name: "not_expired", passed: true, reason: "Recommendation is within its validity window." },
          { name: "asset_approved", passed: true, reason: `${approvedRule.symbol} is an approved treasury asset.` },
          { name: "agent_may_recommend", passed: true, reason: `The Agent is permitted to recommend ${approvedRule.symbol}.` },
          { name: "within_asset_limit", passed: true, reason: `Amount is within the single-purchase limit for ${approvedRule.symbol}.` },
          { name: "reserve_floor_maintained", passed: true, reason: "USDG reserve stays at or above the policy minimum after this trade." },
        ],
        createdAt: "Just now",
      },
    });
  }

  if (blockedRule) {
    const overLimitAmount = blockedRule.maxSinglePurchaseUsd > 0 ? blockedRule.maxSinglePurchaseUsd * 5 : 250_000;
    steps.push({
      id: `${idBase}-step-2`,
      order: steps.length,
      condition: `Execute only if ${blockedRule.symbol} is approved for trading and the amount fits its single-purchase limit.`,
      stopRule: "Halt the remaining plan if this step stays policy-blocked.",
      recommendation: {
        id: `${idBase}-rec-2`,
        projectSlug: slug,
        title: `Increase ${blockedRule.symbol} position`,
        amount: `$${overLimitAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        amountUsd: overLimitAmount,
        status: "Rejected",
        rationale: `Stretch allocation into ${blockedRule.symbol} to further the objective.`,
        action: "BUY",
        fromAsset: "USDG",
        toAsset: blockedRule.symbol,
        policyResult: "Fail",
        policyChecks: [
          { name: "trading_not_paused", passed: true, reason: "Trading is active." },
          { name: "not_expired", passed: true, reason: "Recommendation is within its validity window." },
          !blockedRule.approved
            ? { name: "asset_approved", passed: false, reason: `${blockedRule.symbol} is not an approved treasury asset.` }
            : { name: "asset_approved", passed: true, reason: `${blockedRule.symbol} is an approved treasury asset.` },
          !blockedRule.approved || !blockedRule.agentMayRecommend
            ? { name: "agent_may_recommend", passed: false, reason: `The Agent is not permitted to recommend ${blockedRule.symbol}.` }
            : { name: "agent_may_recommend", passed: true, reason: `The Agent is permitted to recommend ${blockedRule.symbol}.` },
          ...(blockedRule.approved && blockedRule.agentMayRecommend
            ? [{ name: "within_asset_limit", passed: false, reason: `Amount exceeds the $${blockedRule.maxSinglePurchaseUsd.toLocaleString()} single-purchase limit for ${blockedRule.symbol}.` }]
            : []),
        ],
        createdAt: "Just now",
      },
    });
  }

  return {
    id: idBase,
    projectSlug: slug,
    objective,
    reserveTargetBps: null,
    allocationTargets: [],
    reviewCadence: "weekly",
    status: "Active",
    steps,
    createdAt: "Just now",
  };
}

export async function generateTreasuryPlan(slug: string, objective: string): Promise<TreasuryPlan> {
  await wait(150);
  const bundle = findBundle(slug);
  if (!bundle) throw new Error(`Project "${slug}" was not found.`);
  const plan = buildMockPlan(slug, objective, bundle.policy.assetRules);
  const current = readLocalPlans();
  writeLocalPlans({ ...current, [slug]: [plan, ...(current[slug] ?? [])] });
  return plan;
}

// Mock mode has no raw DB status to check terminality against — every step's
// Recommendation only ever carries the collapsed 3-value status. So "done"
// here just means every step has been decided (no longer Pending), which is
// as far as mock mode can simulate the real confirmed/failed/cancelled split.
function withDerivedMockStatus(plan: TreasuryPlan): TreasuryPlan {
  if (plan.status !== "Active") return plan;
  const allDecided = plan.steps.length > 0 && plan.steps.every((step) => step.recommendation.status !== "Pending");
  return allDecided ? { ...plan, status: "Completed" } : plan;
}

export async function setTreasuryPlanPaused(slug: string, planId: string, paused: boolean): Promise<TreasuryPlan> {
  await wait();
  const current = readLocalPlans();
  const list = current[slug] ?? [];
  const existing = list.find((plan) => plan.id === planId);
  if (!existing) throw new Error("Plan not found.");
  if (withDerivedMockStatus(existing).status === "Completed") throw new Error('This plan is already "completed" and cannot change status.');
  let updatedPlan: TreasuryPlan | null = null;
  const updatedList = list.map((plan) => {
    if (plan.id !== planId) return plan;
    updatedPlan = { ...plan, status: paused ? "Paused" : "Active" };
    return updatedPlan;
  });
  if (!updatedPlan) throw new Error("Plan not found.");
  writeLocalPlans({ ...current, [slug]: updatedList });
  return updatedPlan;
}

export async function regenerateTreasuryPlan(slug: string, planId: string): Promise<TreasuryPlan> {
  await wait(150);
  const current = readLocalPlans();
  const list = current[slug] ?? [];
  const existing = list.find((plan) => plan.id === planId);
  if (!existing) throw new Error("Plan not found.");
  if (withDerivedMockStatus(existing).status === "Completed") throw new Error("A completed plan cannot be regenerated.");
  writeLocalPlans({ ...current, [slug]: list.map((plan) => (plan.id === planId ? { ...plan, status: "Cancelled" as const } : plan)) });
  return generateTreasuryPlan(slug, existing.objective);
}

export async function setPlanStepStatus(slug: string, planId: string, recommendationId: string, status: "approved" | "rejected"): Promise<TreasuryPlan> {
  await wait();
  const current = readLocalPlans();
  const list = current[slug] ?? [];
  const nextStatus = status === "approved" ? "Approved" : "Rejected";
  let updatedPlan: TreasuryPlan | null = null;
  const updatedList = list.map((plan) => {
    if (plan.id !== planId) return plan;
    updatedPlan = withDerivedMockStatus({
      ...plan,
      steps: plan.steps.map((step) => (step.recommendation.id === recommendationId ? { ...step, recommendation: { ...step.recommendation, status: nextStatus } } : step)),
    });
    return updatedPlan;
  });
  if (!updatedPlan) throw new Error("Plan not found.");
  writeLocalPlans({ ...current, [slug]: updatedList });
  return updatedPlan;
}
