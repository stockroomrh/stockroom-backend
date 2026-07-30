export type HealthStatus = "HEALTHY" | "WATCH" | "AT RISK";
export type ProposalStatus = "Pending" | "Approved" | "Rejected";
export type FreshnessStatus = "Live" | "Delayed" | "Stale";

export type TreasuryAssetRule = {
  symbol: string;
  name: string;
  type: "Stablecoin" | "Crypto" | "Stock Token" | "ETF Token";
  approved: boolean;
  maxAllocation: number;
  maxSinglePurchaseUsd: number;
  agentMayRecommend: boolean;
  automaticExecution: boolean;
};

export type ProjectSocials = {
  website?: string;
  x?: string;
  telegram?: string;
};

export type ProjectToken = {
  name: string;
  symbol: string;
  price: number;
  marketCap: number;
  totalSupply: number;
  circulatingSupply: number;
  holderCount: number;
  liquidity: number;
  decimals: number;
  contract: string;
  launchTx: string;
  deploymentDate: string;
  distribution: { label: string; percentage: number }[];
  /** Live mode only. "pons" = launched via Pons (real market, fees redirect to treasury); undefined/"stockroom" = plain fixed-supply deployment with no market. */
  launchProvider?: "stockroom" | "pons";
  /** Live mode only, Pons launches only: the real Uniswap V3 pool address. */
  poolAddress?: string;
};

export type Project = {
  id: string;
  slug: string;
  name: string;
  ticker: string;
  description: string;
  shortDescription: string;
  logoText: string;
  accent: string;
  creatorWallet: string;
  treasuryAddress: string;
  treasuryObjective: string;
  launchDate: string;
  featured: boolean;
  trendingScore: number;
  socials: ProjectSocials;
  token: ProjectToken;
  /** Live mode only: uploaded avatar/banner images. Preview projects use logoText/accent instead. */
  logoUrl?: string;
  bannerUrl?: string;
};

export type TreasurySummary = {
  value: number;
  reserve: number;
  reserveTarget: number;
  change30d: number;
  change30dUsd: number;
  runway: number;
  revenue30d: number;
  expenses30d: number;
  deposits30d: number;
  withdrawals30d: number;
  updated: string;
  health: HealthStatus;
  chainStatus: "Live" | "Degraded";
  policyRulesPassing: number;
  policyRulesTotal: number;
};

export type TreasurySnapshot = {
  date: string;
  value: number;
};

export type TreasuryPosition = {
  symbol: string;
  name: string;
  type: "Stablecoin" | "Crypto" | "Stock Token" | "ETF Token";
  balance: string;
  price: number;
  value: number;
  allocation: number;
  change24h: number;
  freshness: FreshnessStatus;
  contract: string;
  contractUrl: string;
  priceSource: string;
  multiplier: number;
  averageAcquisitionPrice: number;
  recentTrades: {
    id: string;
    date: string;
    side: "Buy" | "Sell";
    amount: string;
    value: number;
  }[];
};

export type ActivityType = "Deposit" | "Revenue" | "Trade" | "Expense" | "Withdrawal" | "Unclassified" | "Policy" | "Report";

export type ActivityItem = {
  id: string;
  time: string;
  timestamp: string;
  type: ActivityType;
  description: string;
  asset: string;
  amount: string;
  usdValue: string;
  status: "Confirmed" | "Pending" | "Needs review";
  blockscoutUrl: string;
};

export type TreasuryPolicy = {
  version: string;
  minimumReserve: number;
  maximumSingleAsset: number;
  maximumCrypto: number;
  maximumTrade: number;
  humanApproval: boolean;
  automatedExecution: boolean;
  approvedAssets: string[];
  assetRules: TreasuryAssetRule[];
  updatedAt: string;
  history: {
    version: string;
    date: string;
    summary: string;
  }[];
};

export type AgentReport = {
  id: string;
  createdAt: string;
  health: HealthStatus;
  title: string;
  summary: string;
  findings: string[];
  warnings: string[];
  policyValidation: string;
};

/** One named rule the deterministic policy engine evaluated — see lib/server/policy/policy-engine.ts's PolicyCheck. */
export type PolicyCheckResult = {
  name: string;
  passed: boolean;
  reason: string;
};

export type Recommendation = {
  id: string;
  projectSlug: string;
  title: string;
  amount: string;
  amountUsd: number;
  status: ProposalStatus;
  rationale: string;
  action: string;
  fromAsset: string;
  toAsset: string;
  policyResult: "Pass" | "Fail" | "Human approval";
  /** The full, itemized rule-by-rule trace behind policyResult — empty when nothing was evaluated (e.g. a HOLD). */
  policyChecks: PolicyCheckResult[];
  createdAt: string;
};

export type PlanStatus = "Draft" | "Active" | "Paused" | "Completed" | "Cancelled";

export type PlanStep = {
  id: string;
  order: number;
  condition: string;
  stopRule: string | null;
  /** Each step is a normal Recommendation underneath — same lifecycle, same policy evaluation. */
  recommendation: Recommendation;
};

export type AllocationTarget = {
  symbol: string;
  targetBps: number;
};

export type TreasuryPlan = {
  id: string;
  projectSlug: string;
  objective: string;
  reserveTargetBps: number | null;
  allocationTargets: AllocationTarget[];
  reviewCadence: "daily" | "weekly" | "monthly";
  status: PlanStatus;
  steps: PlanStep[];
  createdAt: string;
};

export type TradeQuote = {
  id: string;
  recommendationId: string;
  inputAsset: string;
  outputAsset: string;
  inputAmount: string;
  expectedOutput: string;
  priceImpact: number;
  feesUsd: number;
  network: string;
  expiresAt: string;
};

export type UserProject = {
  projectSlug: string;
  role: "Owner" | "Operator" | "Viewer";
  operationalStatus: "Live" | "Draft" | "Paused";
  pendingRecommendations: number;
};

export type ProjectBundle = {
  project: Project;
  /** Null until the treasury has been indexed at least once (e.g. a freshly created Live project). */
  summary: TreasurySummary | null;
  history: TreasurySnapshot[];
  positions: TreasuryPosition[];
  activity: ActivityItem[];
  policy: TreasuryPolicy;
  reports: AgentReport[];
  recommendations: Recommendation[];
  userProject: UserProject;
};

export type LaunchProjectInput = {
  projectName: string;
  projectSymbol: string;
  description: string;
  website: string;
  tokenName: string;
  tokenSymbol: string;
  totalSupply: number;
  decimals: number;
  initialReserve: number;
  revenueRouting: string;
  minimumReserve: number;
  maximumSingleAsset: number;
  maximumCrypto: number;
  maximumTrade: number;
  treasuryObjective: string;
  riskApproach: string;
  reportingFrequency: string;
  assetRules: TreasuryAssetRule[];
  /** Live mode only: an existing, user-controlled wallet/multisig address. Never generated by the app. */
  treasuryAddress?: string;
  /** Live mode only: URLs already uploaded to Supabase Storage before submit. */
  logoUrl?: string;
  bannerUrl?: string;
};
