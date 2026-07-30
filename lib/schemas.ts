import { z } from "zod";

export const ProjectSocialsSchema = z.object({
  website: z.string().optional(),
  x: z.string().optional(),
  telegram: z.string().optional(),
});

export const ProjectTokenSchema = z.object({
  name: z.string(), symbol: z.string(), price: z.number(), marketCap: z.number(),
  totalSupply: z.number(), circulatingSupply: z.number(), holderCount: z.number(),
  liquidity: z.number(), decimals: z.number(), contract: z.string(), launchTx: z.string(),
  deploymentDate: z.string(),
  distribution: z.array(z.object({ label: z.string(), percentage: z.number() })),
  launchProvider: z.enum(["stockroom", "pons"]).optional(),
  poolAddress: z.string().optional(),
});

export const ProjectSchema = z.object({
  id: z.string(), slug: z.string(), name: z.string(), ticker: z.string(),
  description: z.string(), shortDescription: z.string(), logoText: z.string(),
  accent: z.string(), creatorWallet: z.string(), treasuryAddress: z.string(),
  treasuryObjective: z.string(), launchDate: z.string(), featured: z.boolean(),
  trendingScore: z.number(), socials: ProjectSocialsSchema, token: ProjectTokenSchema,
  logoUrl: z.string().optional(), bannerUrl: z.string().optional(),
});

export const TreasurySummarySchema = z.object({
  value: z.number(), reserve: z.number(), reserveTarget: z.number(), change30d: z.number(),
  change30dUsd: z.number(), runway: z.number(), revenue30d: z.number(), expenses30d: z.number(),
  deposits30d: z.number(), withdrawals30d: z.number(), updated: z.string(),
  health: z.enum(["HEALTHY", "WATCH", "AT RISK"]), chainStatus: z.enum(["Live", "Degraded"]),
  policyRulesPassing: z.number(), policyRulesTotal: z.number(),
});

export const TreasurySnapshotSchema = z.object({ date: z.string(), value: z.number() });


export const TreasuryAssetRuleSchema = z.object({
  symbol: z.string(), name: z.string(),
  type: z.enum(["Stablecoin", "Crypto", "Stock Token", "ETF Token"]),
  approved: z.boolean(), maxAllocation: z.number(), maxSinglePurchaseUsd: z.number(),
  agentMayRecommend: z.boolean(), automaticExecution: z.boolean(),
});

export const TreasuryPositionSchema = z.object({
  symbol: z.string(), name: z.string(), type: z.enum(["Stablecoin", "Crypto", "Stock Token", "ETF Token"]),
  balance: z.string(), price: z.number(), value: z.number(), allocation: z.number(), change24h: z.number(),
  freshness: z.enum(["Live", "Delayed", "Stale"]), contract: z.string(), contractUrl: z.string(),
  priceSource: z.string(), multiplier: z.number(), averageAcquisitionPrice: z.number(),
  recentTrades: z.array(z.object({ id: z.string(), date: z.string(), side: z.enum(["Buy", "Sell"]), amount: z.string(), value: z.number() })),
});

export const ActivityItemSchema = z.object({
  id: z.string(), time: z.string(), timestamp: z.string(),
  type: z.enum(["Deposit", "Revenue", "Trade", "Expense", "Withdrawal", "Unclassified", "Policy", "Report"]),
  description: z.string(), asset: z.string(), amount: z.string(), usdValue: z.string(),
  status: z.enum(["Confirmed", "Pending", "Needs review"]), blockscoutUrl: z.string(),
});

export const TreasuryPolicySchema = z.object({
  version: z.string(), minimumReserve: z.number(), maximumSingleAsset: z.number(),
  maximumCrypto: z.number(), maximumTrade: z.number(), humanApproval: z.boolean(),
  automatedExecution: z.boolean(), approvedAssets: z.array(z.string()), assetRules: z.array(TreasuryAssetRuleSchema), updatedAt: z.string(),
  history: z.array(z.object({ version: z.string(), date: z.string(), summary: z.string() })),
});

export const AgentReportSchema = z.object({
  id: z.string(), createdAt: z.string(), health: z.enum(["HEALTHY", "WATCH", "AT RISK"]),
  title: z.string(), summary: z.string(), findings: z.array(z.string()), warnings: z.array(z.string()), policyValidation: z.string(),
});

const PolicyCheckResultSchema = z.object({ name: z.string(), passed: z.boolean(), reason: z.string() });

export const RecommendationSchema = z.object({
  id: z.string(), projectSlug: z.string(), title: z.string(), amount: z.string(), amountUsd: z.number(),
  status: z.enum(["Pending", "Approved", "Rejected"]), rationale: z.string(), action: z.string(),
  fromAsset: z.string(), toAsset: z.string(), policyResult: z.enum(["Pass", "Fail", "Human approval"]),
  policyChecks: z.array(PolicyCheckResultSchema).default([]), createdAt: z.string(),
});

export const TradeQuoteSchema = z.object({
  id: z.string(), recommendationId: z.string(), inputAsset: z.string(), outputAsset: z.string(),
  inputAmount: z.string(), expectedOutput: z.string(), priceImpact: z.number(), feesUsd: z.number(), network: z.string(), expiresAt: z.string(),
});

export const LaunchProjectInputSchema = z.object({
  projectName: z.string().min(1).max(120),
  projectSymbol: z.string().min(1).max(8),
  description: z.string().min(1).max(2000),
  website: z.string().max(300).optional().default(""),
  tokenName: z.string().max(120),
  tokenSymbol: z.string().max(16),
  totalSupply: z.number().positive(),
  decimals: z.number().int().min(0).max(18),
  initialReserve: z.number().nonnegative(),
  revenueRouting: z.string(),
  minimumReserve: z.number().min(0).max(100),
  maximumSingleAsset: z.number().min(0).max(100),
  maximumCrypto: z.number().min(0).max(100),
  maximumTrade: z.number().min(0).max(100),
  treasuryObjective: z.string().max(2000),
  riskApproach: z.string(),
  reportingFrequency: z.string(),
  assetRules: z.array(TreasuryAssetRuleSchema),
  treasuryAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid EVM address").optional(),
  logoUrl: z.string().url().optional(),
  bannerUrl: z.string().url().optional(),
});
