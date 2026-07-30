import { describe, expect, it } from "vitest";
import { buildCfoUserContent, type CfoPromptInput } from "./cfo-prompt";

const baseInput: CfoPromptInput = {
  projectName: "Meridian",
  treasuryObjective: "Grow the public treasury while staying reserve-safe.",
  summary: {
    value: 38_000, reserve: 63.2, reserveTarget: 60, change30d: 5, change30dUsd: 1800,
    runway: 12, revenue30d: 0, expenses30d: 0, deposits30d: 0, withdrawals30d: 0,
    updated: "July 26, 2026", health: "HEALTHY", chainStatus: "Live", policyRulesPassing: 3, policyRulesTotal: 3,
  },
  positions: [
    { symbol: "USDG", name: "Global Dollar", type: "Stablecoin", balance: "24000", price: 1, value: 24000, allocation: 63.2, change24h: 0, freshness: "Live", contract: "0x0", contractUrl: "", priceSource: "reference", multiplier: 1, averageAcquisitionPrice: 1, recentTrades: [] },
  ],
  activity: [],
  policy: {
    version: "1.0", minimumReserve: 60, maximumSingleAsset: 20, maximumCrypto: 15, maximumTrade: 10,
    humanApproval: true, automatedExecution: false, approvedAssets: ["USDG", "TSLA"],
    assetRules: [{ symbol: "TSLA", name: "Tesla Stock Token", type: "Stock Token", approved: true, maxAllocation: 20, maxSinglePurchaseUsd: 2500, agentMayRecommend: true, automaticExecution: false }],
    updatedAt: "July 26, 2026", history: [],
  },
  previousReports: [],
  openRecommendations: [],
};

describe("buildCfoUserContent", () => {
  it("includes the treasury objective, summary figures and approved assets", () => {
    const content = buildCfoUserContent(baseInput);
    expect(content).toContain("Meridian");
    expect(content).toContain("Grow the public treasury");
    expect(content).toContain("63.2%");
    expect(content).toContain("TSLA");
  });

  it("handles a null summary and empty lists without throwing", () => {
    const content = buildCfoUserContent({ ...baseInput, summary: null, positions: [], activity: [], previousReports: [], openRecommendations: [] });
    expect(content).toContain("No treasury snapshot has been indexed yet.");
    expect(content).toContain("No positions recorded yet");
    expect(content).toContain("No recent onchain activity recorded.");
  });
});
