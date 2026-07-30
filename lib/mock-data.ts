import type {
  ActivityItem,
  AgentReport,
  Project,
  ProjectBundle,
  Recommendation,
  TreasuryPolicy,
  TreasuryPosition,
  TreasurySnapshot,
  TreasurySummary,
} from "./types";
import { createAssetRules } from "./asset-catalog";

const explorer = "https://explorer.testnet.robinhood.com";

function address(seed: string) {
  const clean = seed.replace(/[^a-f0-9]/gi, "a").toLowerCase();
  return `0x${(clean + "1234567890abcdef".repeat(4)).slice(0, 40)}`;
}

function history(end: number, variance: number): TreasurySnapshot[] {
  const labels = ["Apr 23","Apr 26","Apr 29","May 2","May 5","May 8","May 11","May 14","May 17","May 20","May 23","May 26","May 29","Jun 1","Jun 4","Jun 7","Jun 10","Jun 13","Jun 16","Jun 19","Jun 22"];
  return labels.map((date, index) => {
    const progress = 0.53 + index * 0.0235;
    const wave = Math.sin(index * 1.45) * variance + Math.cos(index * 0.62) * variance * 0.35;
    return { date, value: Math.round(end * progress + wave) };
  }).map((point, index, all) => index === all.length - 1 ? { ...point, value: end } : point);
}

function position(
  symbol: string,
  name: string,
  type: TreasuryPosition["type"],
  value: number,
  allocation: number,
  price: number,
  change24h: number,
  freshness: TreasuryPosition["freshness"] = "Live",
): TreasuryPosition {
  const balance = price === 1 ? value.toFixed(2) : (value / price).toFixed(type === "Crypto" ? 4 : 3);
  return {
    symbol,
    name,
    type,
    balance,
    price,
    value,
    allocation,
    change24h,
    freshness,
    contract: address(symbol),
    contractUrl: `${explorer}/address/${address(symbol)}`,
    priceSource: type === "Stablecoin" ? "USDG reference feed" : "Robinhood market data",
    multiplier: 1,
    averageAcquisitionPrice: price * (1 - change24h / 100 * 0.7),
    recentTrades: [
      { id: `${symbol}-1`, date: "Jun 19, 2026", side: "Buy", amount: type === "Stablecoin" ? "$2,000" : `${(value / price * 0.18).toFixed(3)} ${symbol}`, value: Math.round(value * 0.18) },
      { id: `${symbol}-2`, date: "Jun 04, 2026", side: change24h < 0 ? "Sell" : "Buy", amount: type === "Stablecoin" ? "$1,250" : `${(value / price * 0.11).toFixed(3)} ${symbol}`, value: Math.round(value * 0.11) },
    ],
  };
}

function activity(slug: string, projectName: string, extraAsset: string): ActivityItem[] {
  return [
    { id: `${slug}-a1`, time: "2h ago", timestamp: "2026-07-26T12:20:00Z", type: "Revenue", description: `${projectName} protocol revenue`, asset: "USDG", amount: "+2,000.00", usdValue: "$2,000.00", status: "Confirmed", blockscoutUrl: `${explorer}/tx/${address(slug + "a1")}` },
    { id: `${slug}-a2`, time: "5h ago", timestamp: "2026-07-26T09:10:00Z", type: "Trade", description: `Purchased ${extraAsset}`, asset: extraAsset, amount: "+0.812", usdValue: "$796.13", status: "Confirmed", blockscoutUrl: `${explorer}/tx/${address(slug + "a2")}` },
    { id: `${slug}-a3`, time: "1d ago", timestamp: "2026-07-25T13:05:00Z", type: "Deposit", description: "Treasury reserve deposit", asset: "USDG", amount: "+5,000.00", usdValue: "$5,000.00", status: "Confirmed", blockscoutUrl: `${explorer}/tx/${address(slug + "a3")}` },
    { id: `${slug}-a4`, time: "2d ago", timestamp: "2026-07-24T16:22:00Z", type: "Report", description: "Treasury Agent report published", asset: "—", amount: "—", usdValue: "—", status: "Confirmed", blockscoutUrl: `${explorer}/tx/${address(slug + "a4")}` },
    { id: `${slug}-a5`, time: "3d ago", timestamp: "2026-07-23T11:45:00Z", type: "Expense", description: "Infrastructure and operations", asset: "USDG", amount: "-300.00", usdValue: "-$300.00", status: "Confirmed", blockscoutUrl: `${explorer}/tx/${address(slug + "a5")}` },
    { id: `${slug}-a6`, time: "5d ago", timestamp: "2026-07-21T08:30:00Z", type: "Unclassified", description: "Incoming transfer awaiting classification", asset: "USDG", amount: "+425.00", usdValue: "$425.00", status: "Needs review", blockscoutUrl: `${explorer}/tx/${address(slug + "a6")}` },
  ];
}

function policy(slug: string, reserve: number, single: number, crypto: number, trade: number, assets: string[]): TreasuryPolicy {
  return {
    version: "1.2",
    minimumReserve: reserve,
    maximumSingleAsset: single,
    maximumCrypto: crypto,
    maximumTrade: trade,
    humanApproval: true,
    automatedExecution: false,
    approvedAssets: assets,
    assetRules: createAssetRules(assets, single),
    updatedAt: "July 18, 2026",
    history: [
      { version: "1.2", date: "July 18, 2026", summary: "Added SPY Stock Token and reduced maximum trade size." },
      { version: "1.1", date: "June 29, 2026", summary: "Introduced maximum crypto allocation." },
      { version: "1.0", date: "June 12, 2026", summary: `${slug} treasury policy activated.` },
    ],
  };
}

function reports(slug: string, health: AgentReport["health"], summary: string, warning: string): AgentReport[] {
  return [
    {
      id: `${slug}-report-3`, createdAt: "2 hours ago", health, title: "Weekly treasury review", summary,
      findings: ["Treasury remains solvent under the current operating plan.", "All observed assets match the approved asset list.", "No unexplained material withdrawals were detected."],
      warnings: warning ? [warning] : [],
      policyValidation: health === "HEALTHY" ? "All active treasury rules pass." : health === "WATCH" ? "One policy threshold needs attention; proposals remain human-approved." : "Two policy thresholds require operator review before new risk exposure.",
    },
    {
      id: `${slug}-report-2`, createdAt: "7 days ago", health: health === "AT RISK" ? "WATCH" : health, title: "Treasury monitoring report", summary: "Portfolio composition remained stable and all recorded transactions reconciled with the public ledger.",
      findings: ["Revenue covered operating expenses for the period.", "Market-data sources returned within the expected freshness window."], warnings: [], policyValidation: "No blocked actions were detected.",
    },
    {
      id: `${slug}-report-1`, createdAt: "14 days ago", health: "HEALTHY", title: "Initial treasury baseline", summary: "The Treasury Agent established the first public balance-sheet baseline and validated the active mandate.",
      findings: ["Initial treasury assets were classified.", "Human approval remains required for every proposed trade."], warnings: [], policyValidation: "Initial policy validation completed.",
    },
  ];
}

function recommendations(slug: string, reserveGap: number, asset: string): Recommendation[] {
  const passingChecks = (assetSymbol: string) => [
    { name: "trading_not_paused", passed: true, reason: "Trading is active." },
    { name: "not_expired", passed: true, reason: "Recommendation is within its validity window." },
    { name: "asset_approved", passed: true, reason: `${assetSymbol} is an approved treasury asset.` },
    { name: "agent_may_recommend", passed: true, reason: `The Agent is permitted to recommend ${assetSymbol}.` },
    { name: "within_asset_limit", passed: true, reason: `Amount is within the single-purchase limit for ${assetSymbol}.` },
    { name: "reserve_floor_maintained", passed: true, reason: "USDG reserve stays at or above the policy minimum after this trade." },
  ];
  return [
    { id: `${slug}-r1`, projectSlug: slug, title: reserveGap > 0 ? "Build USDG reserves" : `Increase ${asset} gradually`, amount: reserveGap > 0 ? "$2,000.00" : "$1,500.00", amountUsd: reserveGap > 0 ? 2000 : 1500, status: "Pending", rationale: reserveGap > 0 ? `Reserve allocation is ${reserveGap}% below the treasury policy floor.` : "Reserve requirements are satisfied and diversified exposure remains below the approved limit.", action: reserveGap > 0 ? "Route the next available income to USDG." : `Purchase ${asset} using available USDG.`, fromAsset: "USDG", toAsset: reserveGap > 0 ? "USDG" : asset, policyResult: "Human approval", policyChecks: passingChecks(asset), createdAt: "2 hours ago" },
    { id: `${slug}-r2`, projectSlug: slug, title: `Rebalance ${asset} exposure`, amount: "$1,250.00", amountUsd: 1250, status: "Approved", rationale: "The allocation remains inside policy but is outside the internal target band.", action: `Rebalance the ${asset} position.`, fromAsset: asset, toAsset: "USDG", policyResult: "Pass", policyChecks: passingChecks(asset), createdAt: "8 days ago" },
    { id: `${slug}-r3`, projectSlug: slug, title: "Increase risk allocation", amount: "$3,500.00", amountUsd: 3500, status: "Rejected", rationale: "The proposal was declined while the reserve position was being reviewed.", action: `Purchase ${asset}.`, fromAsset: "USDG", toAsset: asset, policyResult: "Human approval", policyChecks: [
      ...passingChecks(asset).slice(0, 4),
      { name: "within_asset_limit", passed: false, reason: `Amount exceeds the single-purchase limit for ${asset}.` },
    ], createdAt: "16 days ago" },
  ];
}

function makeBundle(config: {
  project: Project;
  summary: TreasurySummary;
  positions: TreasuryPosition[];
  policy: TreasuryPolicy;
  reportSummary: string;
  reportWarning: string;
  recommendationAsset: string;
  role?: "Owner" | "Operator" | "Viewer";
}): ProjectBundle {
  return {
    project: config.project,
    summary: config.summary,
    history: history(config.summary.value, config.summary.value * 0.025),
    positions: config.positions,
    activity: activity(config.project.slug, config.project.name, config.recommendationAsset),
    policy: config.policy,
    reports: reports(config.project.slug, config.summary.health, config.reportSummary, config.reportWarning),
    recommendations: recommendations(config.project.slug, Math.max(0, config.summary.reserveTarget - config.summary.reserve), config.recommendationAsset),
    userProject: { projectSlug: config.project.slug, role: config.role ?? "Owner", operationalStatus: "Live", pendingRecommendations: 1 },
  };
}

export const builtInProjectBundles: ProjectBundle[] = [
  makeBundle({
    project: {
      id: "project-stockroom", slug: "stockroom", name: "Stockroom", ticker: "STOCK",
      description: "Stockroom is the public treasury launchpad on Robinhood Chain. Its flagship treasury demonstrates how a token can launch with a visible balance sheet, deterministic mandate and human-approved financial operations.",
      shortDescription: "The public treasury launchpad.", logoText: "S", accent: "#d9ff00",
      creatorWallet: address("stockroom-creator"), treasuryAddress: address("stockroom-treasury"),
      treasuryObjective: "Maintain strong USDG reserves while building diversified exposure to approved Stock Tokens and crypto assets.",
      launchDate: "June 12, 2026", featured: true, trendingScore: 98,
      socials: { website: "https://stockroom.example", x: "https://x.com/stockroom", telegram: "https://t.me/stockroom" },
      token: { name: "Stockroom Token", symbol: "STOCK", price: 0.0384, marketCap: 38420520, totalSupply: 1_000_000_000, circulatingSupply: 620_000_000, holderCount: 4280, liquidity: 1_240_000, decimals: 18, contract: address("stock-token"), launchTx: address("stock-launch"), deploymentDate: "June 12, 2026", distribution: [{label:"Community",percentage:55},{label:"Liquidity",percentage:20},{label:"Treasury",percentage:15},{label:"Team",percentage:10}] },
    },
    summary: { value: 38420.52, reserve: 57, reserveTarget: 60, change30d: 4.2, change30dUsd: 1542.21, runway: 8.4, revenue30d: 4250, expenses30d: 1600, deposits30d: 7250, withdrawals30d: 2230, updated: "24 seconds ago", health: "WATCH", chainStatus: "Live", policyRulesPassing: 7, policyRulesTotal: 8 },
    positions: [position("USDG","Global Dollar","Stablecoin",21900.19,57,1,0.01),position("NVDAx","NVIDIA Stock Token","Stock Token",6677.28,17.4,980.21,2.31),position("AAPLx","Apple Stock Token","Stock Token",4321.56,11.2,179.23,-0.45),position("ETH","Ether","Crypto",3041.26,7.9,2464.12,1.02),position("SPYx","SPY ETF Token","ETF Token",2480.23,6.5,272.42,0.37,"Delayed")],
    policy: policy("Stockroom",60,20,15,10,["USDG","ETH","NVDAx","AAPLx","SPYx"]),
    reportSummary: "USDG reserves are below the 60% policy floor following the latest Stock Token purchase. The treasury remains solvent with 8.4 months of runway, but new risk exposure should pause until reserves recover.",
    reportWarning: "USDG reserves are 3% below the active policy target.", recommendationAsset: "NVDAx",
  }),
  makeBundle({
    project: {
      id: "project-northstar", slug: "northstar", name: "Northstar", ticker: "NSTR",
      description: "Northstar coordinates capital for open data infrastructure and publishes every treasury movement through Stockroom.",
      shortDescription: "Open data infrastructure, publicly financed.", logoText: "N", accent: "#5dd7ff",
      creatorWallet: address("northstar-creator"), treasuryAddress: address("northstar-treasury"), treasuryObjective: "Preserve a 62% reserve floor while gaining measured exposure to infrastructure and broad-market assets.", launchDate: "May 28, 2026", featured: true, trendingScore: 91,
      socials: { website: "https://northstar.example", x: "https://x.com/northstar" },
      token: { name: "Northstar Token", symbol: "NSTR", price: 0.1268, marketCap: 63420370, totalSupply: 500_000_000, circulatingSupply: 330_000_000, holderCount: 6190, liquidity: 2_750_000, decimals: 18, contract: address("northstar-token"), launchTx: address("northstar-launch"), deploymentDate: "May 28, 2026", distribution: [{label:"Community",percentage:48},{label:"Liquidity",percentage:24},{label:"Treasury",percentage:18},{label:"Core contributors",percentage:10}] },
    },
    summary: { value: 126840.74, reserve: 64, reserveTarget: 62, change30d: 9.8, change30dUsd: 11318.55, runway: 15.2, revenue30d: 18220, expenses30d: 6280, deposits30d: 22000, withdrawals30d: 5110, updated: "41 seconds ago", health: "HEALTHY", chainStatus: "Live", policyRulesPassing: 9, policyRulesTotal: 9 },
    positions: [position("USDG","Global Dollar","Stablecoin",81178.07,64,1,0),position("SPYx","SPY ETF Token","ETF Token",19026.11,15,272.42,0.37),position("NVDAx","NVIDIA Stock Token","Stock Token",13952.48,11,980.21,2.31),position("ETH","Ether","Crypto",8878.85,7,2464.12,1.02),position("AAPLx","Apple Stock Token","Stock Token",3805.23,3,179.23,-0.45)],
    policy: policy("Northstar",62,18,12,8,["USDG","ETH","NVDAx","AAPLx","SPYx"]),
    reportSummary: "Northstar remains fully policy compliant. Reserve coverage is above target, runway has extended to 15.2 months and market exposure remains diversified.", reportWarning: "", recommendationAsset: "SPYx", role: "Operator",
  }),
  makeBundle({
    project: {
      id: "project-commons", slug: "commons", name: "Commons", ticker: "CMNS",
      description: "Commons funds community software and public digital goods through a transparent, policy-bound treasury.",
      shortDescription: "A balance sheet for public goods.", logoText: "C", accent: "#ffcf47",
      creatorWallet: address("commons-creator"), treasuryAddress: address("commons-treasury"), treasuryObjective: "Fund recurring grants without allowing treasury reserves to fall below a sustainable operating threshold.", launchDate: "July 03, 2026", featured: false, trendingScore: 86,
      socials: { website: "https://commons.example", x: "https://x.com/commons" },
      token: { name: "Commons Token", symbol: "CMNS", price: 0.0742, marketCap: 18555045, totalSupply: 250_000_000, circulatingSupply: 142_000_000, holderCount: 2188, liquidity: 684000, decimals: 18, contract: address("commons-token"), launchTx: address("commons-launch"), deploymentDate: "July 03, 2026", distribution: [{label:"Community",percentage:60},{label:"Liquidity",percentage:15},{label:"Treasury",percentage:20},{label:"Contributors",percentage:5}] },
    },
    summary: { value: 74220.18, reserve: 48, reserveTarget: 58, change30d: -3.6, change30dUsd: -2771.74, runway: 5.9, revenue30d: 7850, expenses30d: 10420, deposits30d: 6250, withdrawals30d: 11760, updated: "1 minute ago", health: "AT RISK", chainStatus: "Live", policyRulesPassing: 6, policyRulesTotal: 9 },
    positions: [position("USDG","Global Dollar","Stablecoin",35625.69,48,1,0),position("ETH","Ether","Crypto",14844.04,20,2464.12,1.02),position("AAPLx","Apple Stock Token","Stock Token",11133.03,15,179.23,-0.45),position("NVDAx","NVIDIA Stock Token","Stock Token",8906.42,12,980.21,2.31),position("SPYx","SPY ETF Token","ETF Token",3711,5,272.42,0.37,"Delayed")],
    policy: policy("Commons",58,18,18,7,["USDG","ETH","AAPLx","NVDAx","SPYx"]),
    reportSummary: "Grant outflows and operating expenses have reduced reserves below the active mandate. The treasury should rebuild USDG and pause new risk allocations until runway improves.", reportWarning: "Reserve coverage and crypto allocation are both outside policy targets.", recommendationAsset: "ETH", role: "Viewer",
  }),
  makeBundle({
    project: {
      id: "project-atlas", slug: "atlas-reserve", name: "Atlas Reserve", ticker: "ATLS",
      description: "Atlas Reserve is a conservative onchain reserve vehicle focused on public liquidity, broad-market exposure and long operating runway.",
      shortDescription: "A conservative, public onchain reserve.", logoText: "A", accent: "#9a88ff",
      creatorWallet: address("atlas-creator"), treasuryAddress: address("atlas-treasury"), treasuryObjective: "Maximise capital preservation and runway while maintaining modest, diversified market exposure.", launchDate: "April 19, 2026", featured: true, trendingScore: 89,
      socials: { website: "https://atlasreserve.example", x: "https://x.com/atlasreserve" },
      token: { name: "Atlas Reserve Token", symbol: "ATLS", price: 0.2419, marketCap: 120954155, totalSupply: 500_000_000, circulatingSupply: 296_000_000, holderCount: 9820, liquidity: 5_910_000, decimals: 18, contract: address("atlas-token"), launchTx: address("atlas-launch"), deploymentDate: "April 19, 2026", distribution: [{label:"Public",percentage:50},{label:"Liquidity",percentage:25},{label:"Treasury",percentage:20},{label:"Team",percentage:5}] },
    },
    summary: { value: 241908.31, reserve: 71, reserveTarget: 68, change30d: 6.4, change30dUsd: 14551.63, runway: 22.6, revenue30d: 24450, expenses30d: 5840, deposits30d: 31200, withdrawals30d: 4450, updated: "18 seconds ago", health: "HEALTHY", chainStatus: "Live", policyRulesPassing: 10, policyRulesTotal: 10 },
    positions: [position("USDG","Global Dollar","Stablecoin",171754.9,71,1,0),position("SPYx","SPY ETF Token","ETF Token",33867.16,14,272.42,0.37),position("AAPLx","Apple Stock Token","Stock Token",19352.66,8,179.23,-0.45),position("NVDAx","NVIDIA Stock Token","Stock Token",9676.33,4,980.21,2.31),position("ETH","Ether","Crypto",7257.25,3,2464.12,1.02)],
    policy: policy("Atlas Reserve",68,15,8,6,["USDG","ETH","NVDAx","AAPLx","SPYx"]),
    reportSummary: "Atlas Reserve remains above every active reserve and allocation threshold. Runway is 22.6 months and no immediate corrective action is required.", reportWarning: "", recommendationAsset: "SPYx",
  }),
];

export const defaultProjectSlug = "stockroom";
