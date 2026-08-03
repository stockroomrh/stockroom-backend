import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityItem, LaunchProjectInput, Project, ProjectBundle, TreasuryAssetRule, TreasuryPolicy, TreasuryPosition, TreasurySnapshot, TreasurySummary } from "@/lib/types";
import { activeChainId } from "@/lib/chain-config";
import { addressUrl, transactionUrl, getTokenHolderCount } from "@/lib/server/chain/blockscout";
import { getPonsTokenMarketData } from "@/lib/server/chain/token-market";
import { getErc20Balances, getNativeBalance } from "@/lib/server/chain/balances";
import { getDexScreenerPriceUsd, getEthDisplayPriceUsd } from "@/lib/server/assets/price-feeds";
import { allocationBps, percentChange, reservePercentage, runwayMonths } from "@/lib/server/assets/valuation";
import { getAgentReportsForProject, getRecommendationsForProject } from "@/lib/server/db/agent-reports";

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || `project-${Date.now()}`;
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "2-digit", year: "numeric" }).format(new Date(value));
}

const bps = (percent: number) => Math.round(percent * 100);
const fromBps = (value: number | null | undefined) => (value ?? 0) / 100;

type TokenRow = {
  name: string; symbol: string; total_supply: number; decimals: number; contract_address: string | null;
  deployment_tx_hash: string | null; launch_provider: string | null; pool_address: string | null; updated_at: string | null;
};

type ProjectRow = {
  id: string;
  slug: string;
  name: string;
  ticker: string;
  description: string;
  short_description: string;
  website_url: string | null;
  socials: { website?: string; x?: string; telegram?: string; marketingWallet?: string } | null;
  logo_url: string | null;
  banner_url: string | null;
  treasury_objective: string;
  status: string;
  created_at: string;
  owner: { wallet_address: string } | { wallet_address: string }[] | null;
  // project_tokens and treasury_accounts both have a UNIQUE constraint on
  // project_id, so PostgREST auto-detects them as one-to-one relationships
  // and embeds a single OBJECT, not an array — same shape as `owner` above.
  // Must go through firstOf() below, never `?.[0]` (silently returns
  // undefined on a plain object and was doing exactly that until this fix).
  project_tokens: (
    TokenRow
    | TokenRow[]
    | null
  );
  treasury_accounts: { address: string } | { address: string }[] | null;
};

export function firstOf<T>(value: T | T[] | null | undefined): T | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

export function mapProject(row: ProjectRow): Project {
  const token = firstOf(row.project_tokens);
  const treasury = firstOf(row.treasury_accounts);
  const owner = firstOf(row.owner);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    ticker: row.ticker,
    description: row.description,
    shortDescription: row.short_description,
    logoText: row.name.slice(0, 1).toUpperCase(),
    accent: "#d9ff00",
    creatorWallet: owner?.wallet_address ?? "",
    treasuryAddress: treasury?.address ?? "",
    marketingWalletAddress: row.socials?.marketingWallet ?? null,
    treasuryObjective: row.treasury_objective,
    launchDate: formatDate(row.created_at),
    featured: false,
    trendingScore: 50,
    socials: { website: row.website_url ?? row.socials?.website, x: row.socials?.x, telegram: row.socials?.telegram },
    logoUrl: row.logo_url ?? undefined,
    bannerUrl: row.banner_url ?? undefined,
    token: {
      name: token?.name ?? row.name,
      symbol: token?.symbol ?? row.ticker,
      price: 0,
      marketCap: 0,
      totalSupply: token?.total_supply ?? 0,
      circulatingSupply: 0,
      holderCount: 0,
      liquidity: 0,
      decimals: token?.decimals ?? 18,
      contract: token?.contract_address ?? "",
      launchTx: token?.deployment_tx_hash ?? "",
      deploymentDate: token?.contract_address ? formatDate(token.updated_at) : "",
      distribution: [],
      launchProvider: token?.launch_provider === "pons" ? "pons" : token?.launch_provider === "stockroom" ? "stockroom" : undefined,
      poolAddress: token?.pool_address ?? undefined,
    },
  };
}

const PROJECT_SELECT = `
  id, slug, name, ticker, description, short_description, website_url, socials, logo_url, banner_url, treasury_objective, status, created_at,
  owner:profiles!owner_profile_id(wallet_address),
  project_tokens(name, symbol, total_supply, decimals, contract_address, deployment_tx_hash, launch_provider, pool_address, updated_at),
  treasury_accounts(address)
`;

export async function listPublishedProjects(supabase: SupabaseClient): Promise<Project[]> {
  const { data, error } = await supabase.from("projects").select(PROJECT_SELECT).eq("status", "published");
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as ProjectRow[]).map(mapProject);
}

export async function getProjectRowBySlug(supabase: SupabaseClient, slug: string): Promise<ProjectRow | null> {
  const { data, error } = await supabase.from("projects").select(PROJECT_SELECT).eq("slug", slug).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as ProjectRow) ?? null;
}

type PolicyRow = {
  id: string;
  minimum_reserve_bps: number;
  maximum_single_asset_bps: number;
  maximum_crypto_bps: number;
  maximum_trade_bps: number;
  require_human_approval: boolean;
  allow_automated_execution: boolean;
  updated_at: string;
  treasury_policy_versions: { version: string; effective_at: string; summary: string }[] | null;
};

type ApprovedAssetRow = {
  approved: boolean;
  max_allocation_bps: number;
  max_single_purchase_usd: number;
  agent_may_recommend: boolean;
  automatic_execution: boolean;
  asset_registry: { symbol: string; name: string; asset_type: TreasuryAssetRule["type"] } | { symbol: string; name: string; asset_type: TreasuryAssetRule["type"] }[] | null;
};

export async function getProjectPolicy(supabase: SupabaseClient, projectId: string): Promise<TreasuryPolicy | null> {
  const { data: policy, error } = await supabase
    .from("treasury_policies")
    // treasury_policies <-> treasury_policy_versions has two FK paths
    // (versions.policy_id -> policies.id, and policies.current_version_id ->
    // versions.id), so the embed must name which column to follow explicitly.
    .select("id, minimum_reserve_bps, maximum_single_asset_bps, maximum_crypto_bps, maximum_trade_bps, require_human_approval, allow_automated_execution, updated_at, treasury_policy_versions!policy_id(version, effective_at, summary)")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!policy) return null;
  const policyRow = policy as unknown as PolicyRow;

  const { data: assets, error: assetsError } = await supabase
    .from("project_approved_assets")
    .select("approved, max_allocation_bps, max_single_purchase_usd, agent_may_recommend, automatic_execution, asset_registry(symbol, name, asset_type)")
    .eq("project_id", projectId);
  if (assetsError) throw new Error(assetsError.message);

  const assetRules: TreasuryAssetRule[] = ((assets ?? []) as unknown as ApprovedAssetRow[])
    .map((row) => {
      const asset = firstOf(row.asset_registry);
      if (!asset) return null;
      return {
        symbol: asset.symbol,
        name: asset.name,
        type: asset.asset_type,
        approved: row.approved,
        maxAllocation: fromBps(row.max_allocation_bps),
        maxSinglePurchaseUsd: row.max_single_purchase_usd,
        agentMayRecommend: row.agent_may_recommend,
        automaticExecution: row.automatic_execution,
      } satisfies TreasuryAssetRule;
    })
    .filter((rule): rule is TreasuryAssetRule => rule !== null);

  const versions = (policyRow.treasury_policy_versions ?? []).slice().sort((a, b) => new Date(b.effective_at).getTime() - new Date(a.effective_at).getTime());

  return {
    version: versions[0]?.version ?? "1.0",
    minimumReserve: fromBps(policyRow.minimum_reserve_bps),
    maximumSingleAsset: fromBps(policyRow.maximum_single_asset_bps),
    maximumCrypto: fromBps(policyRow.maximum_crypto_bps),
    maximumTrade: fromBps(policyRow.maximum_trade_bps),
    humanApproval: policyRow.require_human_approval,
    automatedExecution: policyRow.allow_automated_execution,
    approvedAssets: assetRules.filter((rule) => rule.approved).map((rule) => rule.symbol),
    assetRules,
    updatedAt: formatDate(policyRow.updated_at),
    history: versions.map((version) => ({ version: version.version, date: formatDate(version.effective_at), summary: version.summary })),
  };
}

type SnapshotRow = { id: string; block_number: number | null; total_value_usd: number; reserve_value_usd: number; captured_at: string };
type PositionRow = {
  raw_balance: string; display_balance: number; price_usd: number; value_usd: number; allocation_bps: number;
  price_source: string; price_updated_at: string | null; is_stale: boolean;
  asset_registry: { symbol: string; name: string; asset_type: TreasuryAssetRule["type"]; contract_address: string; current_multiplier: number } | { symbol: string; name: string; asset_type: TreasuryAssetRule["type"]; contract_address: string; current_multiplier: number }[] | null;
};
type ActivityRow = {
  id: string; tx_hash: string | null; occurred_at: string; activity_type: ActivityItem["type"];
  description: string; asset_symbol: string | null; raw_amount: string | null; usd_value: number | null;
  decimals: number | null; counterparty_address: string | null; status: string;
};

/** Never scientific notation, never raw wei — a real display amount for a real token quantity. */
function formatTokenDisplayAmount(rawAmount: string | null, decimals: number | null): string {
  if (!rawAmount) return "0";
  const value = Number(rawAmount) / 10 ** (decimals ?? 18);
  if (!Number.isFinite(value)) return "0";
  if (value === 0) return "0";
  // Small amounts need more precision to not round to 0; large ones don't need 6 decimals of noise.
  const maximumFractionDigits = value < 1 ? 6 : value < 1000 ? 4 : 2;
  return value.toLocaleString(undefined, { maximumFractionDigits, minimumFractionDigits: 0 });
}

export async function getTreasuryData(supabase: SupabaseClient, projectId: string, policy: TreasuryPolicy): Promise<{ summary: TreasurySummary | null; history: TreasurySnapshot[]; positions: TreasuryPosition[]; activity: ActivityItem[] }> {
  const { data: snapshots, error: snapshotsError } = await supabase
    .from("treasury_snapshots")
    .select("id, block_number, total_value_usd, reserve_value_usd, captured_at")
    .eq("project_id", projectId)
    .order("captured_at", { ascending: false })
    .limit(30);
  if (snapshotsError) throw new Error(snapshotsError.message);

  const { data: activityRows, error: activityError } = await supabase
    .from("activity_items")
    .select("id, tx_hash, occurred_at, activity_type, description, asset_symbol, raw_amount, usd_value, decimals, counterparty_address, status")
    .eq("project_id", projectId)
    .order("occurred_at", { ascending: false })
    .limit(50);
  if (activityError) throw new Error(activityError.message);

  const activity: ActivityItem[] = ((activityRows ?? []) as unknown as ActivityRow[]).map((row) => ({
    id: row.id,
    time: formatDate(row.occurred_at),
    timestamp: row.occurred_at,
    type: row.activity_type,
    description: row.description,
    asset: row.asset_symbol ?? "",
    amount: formatTokenDisplayAmount(row.raw_amount, row.decimals),
    usdValue: row.usd_value !== null
      ? `${row.activity_type === "Withdrawal" ? "-" : "+"}$${Math.abs(row.usd_value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
      : "value unavailable",
    status: row.status === "confirmed" ? "Confirmed" : row.status === "needs_review" ? "Needs review" : "Pending",
    blockscoutUrl: row.tx_hash ? transactionUrl(row.tx_hash) : "",
  }));

  const latest = (snapshots ?? [])[0] as SnapshotRow | undefined;
  if (!latest) return { summary: null, history: [], positions: [], activity };

  const history: TreasurySnapshot[] = (snapshots as SnapshotRow[]).slice().reverse().map((s) => ({ date: formatDate(s.captured_at), value: s.total_value_usd }));

  const { data: positionRows, error: positionsError } = await supabase
    .from("treasury_positions")
    .select("raw_balance, display_balance, price_usd, value_usd, allocation_bps, price_source, price_updated_at, is_stale, asset_registry(symbol, name, asset_type, contract_address, current_multiplier)")
    .eq("snapshot_id", latest.id);
  if (positionsError) throw new Error(positionsError.message);

  const positions: TreasuryPosition[] = ((positionRows ?? []) as unknown as PositionRow[])
    .map((row): TreasuryPosition | null => {
      const asset = firstOf(row.asset_registry);
      if (!asset) return null;
      return {
        symbol: asset.symbol,
        name: asset.name,
        type: asset.asset_type,
        balance: row.display_balance.toString(),
        price: row.price_usd,
        value: row.value_usd,
        allocation: fromBps(row.allocation_bps),
        change24h: 0, // requires intraday snapshot history not yet collected
        freshness: row.is_stale ? "Stale" : "Live",
        contract: asset.contract_address,
        contractUrl: addressUrl(asset.contract_address),
        priceSource: row.price_source,
        multiplier: asset.current_multiplier,
        averageAcquisitionPrice: row.price_usd, // no cost-basis tracking yet (needs Stage 5 trade history)
        recentTrades: [],
      };
    })
    .filter((position): position is TreasuryPosition => position !== null);

  const previous = (snapshots as SnapshotRow[]).find((s) => {
    const ageDays = (new Date(latest.captured_at).getTime() - new Date(s.captured_at).getTime()) / 86_400_000;
    return ageDays >= 25; // closest snapshot to ~30 days back among what we've retained
  });

  const reservePct = reservePercentage(latest.reserve_value_usd, latest.total_value_usd);
  const rulesChecks = [
    reservePct >= policy.minimumReserve,
    positions.every((p) => p.allocation <= policy.maximumSingleAsset || p.symbol === "USDG"),
    positions.filter((p) => p.type === "Crypto").reduce((sum, p) => sum + p.allocation, 0) <= policy.maximumCrypto,
  ];

  const summary: TreasurySummary = {
    value: latest.total_value_usd,
    reserve: reservePct,
    reserveTarget: policy.minimumReserve,
    change30d: previous ? percentChange(latest.total_value_usd, previous.total_value_usd) : 0,
    change30dUsd: previous ? latest.total_value_usd - previous.total_value_usd : 0,
    runway: runwayMonths(latest.reserve_value_usd, 0, 0), // revenue/expense tracking requires per-transfer USD valuation — see Stage 3 notes
    revenue30d: 0,
    expenses30d: 0,
    deposits30d: 0,
    withdrawals30d: 0,
    updated: formatDate(latest.captured_at),
    health: reservePct < policy.minimumReserve ? "AT RISK" : reservePct < policy.minimumReserve + 5 ? "WATCH" : "HEALTHY",
    chainStatus: "Live",
    policyRulesPassing: rulesChecks.filter(Boolean).length,
    policyRulesTotal: rulesChecks.length,
  };

  return { summary, history, positions, activity };
}

// A marketing wallet is display-only — it's never read into treasury_positions
// or used for any policy/valuation decision, just a real, live total shown
// alongside the treasury's own value. Returns null (not $0) on any read
// failure so the UI can tell "no data yet" apart from "genuinely worth nothing."
async function getMarketingWalletValueUsd(walletAddress: string, tokenAddress: string, tokenDecimals: number): Promise<number | null> {
  try {
    const [nativeBalance, tokenBalances, ethPrice, tokenPrice] = await Promise.all([
      getNativeBalance(walletAddress as `0x${string}`),
      getErc20Balances(walletAddress as `0x${string}`, [tokenAddress as `0x${string}`]),
      getEthDisplayPriceUsd(),
      getDexScreenerPriceUsd(tokenAddress),
    ]);
    if (nativeBalance === null) return null;

    const ethValue = ethPrice ? (Number(nativeBalance) / 1e18) * ethPrice.priceUsd : 0;
    const tokenEntry = tokenBalances[0];
    const tokenValue = tokenEntry?.success && tokenPrice ? (Number(tokenEntry.rawBalance) / 10 ** tokenDecimals) * tokenPrice.priceUsd : 0;

    return ethValue + tokenValue;
  } catch {
    return null;
  }
}

export async function getProjectBundleBySlug(supabase: SupabaseClient, slug: string, viewerRole: "Owner" | "Operator" | "Viewer" = "Viewer"): Promise<ProjectBundle | null> {
  const row = await getProjectRowBySlug(supabase, slug);
  if (!row) return null;
  const project = mapProject(row);
  const policy = await getProjectPolicy(supabase, row.id);
  if (!policy) return null;

  // Real token market data (deployed tokens only) — a per-project detail
  // fetch, deliberately not done in mapProject/listPublishedProjects since
  // that would mean N pool/RPC reads for every project in a list view.
  if (project.token.contract) {
    const holderCount = await getTokenHolderCount(project.token.contract);
    project.token.holderCount = holderCount;
    if (project.token.launchProvider === "pons" && project.token.poolAddress && project.treasuryAddress) {
      const market = await getPonsTokenMarketData({
        tokenAddress: project.token.contract as `0x${string}`,
        poolAddress: project.token.poolAddress as `0x${string}`,
        treasuryAddress: project.treasuryAddress as `0x${string}`,
        tokenDecimals: project.token.decimals,
        totalSupply: project.token.totalSupply,
      });
      if (market) {
        project.token.price = market.priceUsd;
        project.token.marketCap = market.marketCapUsd;
        project.token.liquidity = market.liquidityUsd;
        project.token.circulatingSupply = market.circulatingSupply;
      }
    }
  }

  if (project.marketingWalletAddress && project.token.contract) {
    project.marketingWalletValueUsd = await getMarketingWalletValueUsd(project.marketingWalletAddress, project.token.contract, project.token.decimals);
  }

  const { summary, history, positions, activity } = await getTreasuryData(supabase, row.id, policy);
  const [reports, recommendations] = await Promise.all([
    getAgentReportsForProject(supabase, row.id),
    getRecommendationsForProject(supabase, row.id, slug, policy.humanApproval),
  ]);

  return {
    project,
    summary,
    history,
    positions,
    activity,
    policy,
    reports,
    recommendations,
    userProject: {
      projectSlug: slug,
      role: viewerRole,
      operationalStatus: row.status === "published" ? "Live" : row.status === "archived" ? "Paused" : "Draft",
      pendingRecommendations: recommendations.filter((rec) => rec.status === "Pending").length,
    },
  };
}

export async function generateUniqueSlug(supabase: SupabaseClient, name: string): Promise<string> {
  const baseSlug = slugify(name);
  let slug = baseSlug;
  let suffix = 2;
  for (;;) {
    const { data } = await supabase.from("projects").select("id").eq("slug", slug).maybeSingle();
    if (!data) return slug;
    slug = `${baseSlug}-${suffix++}`;
  }
}

export async function createProject(supabase: SupabaseClient, ownerId: string, input: LaunchProjectInput): Promise<{ slug: string; projectId: string }> {
  const slug = await generateUniqueSlug(supabase, input.projectName);

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      slug,
      name: input.projectName,
      ticker: input.projectSymbol.toUpperCase().slice(0, 8),
      description: input.description,
      short_description: input.description.slice(0, 90),
      website_url: input.website || null,
      logo_url: input.logoUrl || null,
      banner_url: input.bannerUrl || null,
      treasury_objective: input.treasuryObjective,
      chain_id: activeChainId,
      owner_profile_id: ownerId,
      status: "draft",
    })
    .select("id")
    .single();
  if (projectError || !project) throw new Error(projectError?.message ?? "Failed to create project.");
  const projectId = project.id as string;

  try {
    const { error: memberError } = await supabase.from("project_members").insert({ project_id: projectId, profile_id: ownerId, role: "owner" });
    if (memberError) throw new Error(memberError.message);

    const { error: tokenError } = await supabase.from("project_tokens").insert({
      project_id: projectId,
      name: input.tokenName || `${input.projectName} Token`,
      symbol: (input.tokenSymbol || input.projectSymbol).toUpperCase(),
      total_supply: input.totalSupply,
      decimals: input.decimals,
      status: "not_deployed",
    });
    if (tokenError) throw new Error(tokenError.message);

    if (input.treasuryAddress) {
      const { error: treasuryError } = await supabase.from("treasury_accounts").insert({
        project_id: projectId,
        address: input.treasuryAddress,
        chain_id: activeChainId,
        account_type: "eoa",
        base_currency: "USDG",
      });
      if (treasuryError) throw new Error(treasuryError.message);
    }

    const { data: policyRow, error: policyError } = await supabase
      .from("treasury_policies")
      .insert({
        project_id: projectId,
        minimum_reserve_bps: bps(input.minimumReserve),
        maximum_single_asset_bps: bps(input.maximumSingleAsset),
        maximum_crypto_bps: bps(input.maximumCrypto),
        maximum_trade_bps: bps(input.maximumTrade),
        require_human_approval: true,
        allow_automated_execution: false,
      })
      .select("id")
      .single();
    if (policyError || !policyRow) throw new Error(policyError?.message ?? "Failed to create policy.");

    const { data: versionRow, error: versionError } = await supabase
      .from("treasury_policy_versions")
      .insert({
        policy_id: policyRow.id,
        version: "1.0",
        minimum_reserve_bps: bps(input.minimumReserve),
        maximum_single_asset_bps: bps(input.maximumSingleAsset),
        maximum_crypto_bps: bps(input.maximumCrypto),
        maximum_trade_bps: bps(input.maximumTrade),
        require_human_approval: true,
        allow_automated_execution: false,
        summary: "Initial policy created during launch.",
        created_by: ownerId,
      })
      .select("id")
      .single();
    if (versionError || !versionRow) throw new Error(versionError?.message ?? "Failed to create policy version.");

    const { error: updatePolicyError } = await supabase.from("treasury_policies").update({ current_version_id: versionRow.id }).eq("id", policyRow.id);
    if (updatePolicyError) throw new Error(updatePolicyError.message);

    for (const rule of input.assetRules) {
      const { data: existingAsset, error: findAssetError } = await supabase
        .from("asset_registry")
        .select("id")
        .eq("symbol", rule.symbol)
        .eq("chain_id", activeChainId)
        .maybeSingle();
      if (findAssetError) throw new Error(findAssetError.message);

      let assetId = existingAsset?.id as string | undefined;
      if (!assetId) {
        // Seeded as an unverified placeholder — Stage 3 replaces contract_address
        // with the real canonical address from Robinhood's asset registry before
        // this asset can be used for real chain reads or trading.
        const { data: insertedAsset, error: insertAssetError } = await supabase
          .from("asset_registry")
          .insert({
            chain_id: activeChainId,
            contract_address: `pending:${rule.symbol}`,
            symbol: rule.symbol,
            name: rule.name,
            asset_type: rule.type,
            verification_status: "unverified",
          })
          .select("id")
          .single();
        if (insertAssetError || !insertedAsset) throw new Error(insertAssetError?.message ?? "Failed to register asset.");
        assetId = insertedAsset.id as string;
      }

      const { error: approvedAssetError } = await supabase.from("project_approved_assets").insert({
        project_id: projectId,
        asset_id: assetId,
        approved: rule.approved,
        max_allocation_bps: bps(rule.maxAllocation),
        max_single_purchase_usd: rule.maxSinglePurchaseUsd,
        agent_may_recommend: rule.agentMayRecommend,
        automatic_execution: false,
        trading_enabled: false,
      });
      if (approvedAssetError) throw new Error(approvedAssetError.message);
    }

    const { error: agentSettingsError } = await supabase.from("agent_settings").insert({
      project_id: projectId,
      objective: input.treasuryObjective,
      risk_profile: input.riskApproach,
      reporting_frequency: input.reportingFrequency,
    });
    if (agentSettingsError) throw new Error(agentSettingsError.message);

    const { error: publishError } = await supabase.from("projects").update({ status: "published" }).eq("id", projectId);
    if (publishError) throw new Error(publishError.message);
  } catch (cause) {
    // Best-effort rollback: deleting the project cascades to every child row
    // (project_members, project_tokens, treasury_accounts, treasury_policies,
    // treasury_policy_versions, project_approved_assets, agent_settings).
    await supabase.from("projects").delete().eq("id", projectId);
    throw cause;
  }

  return { slug, projectId };
}

export async function updateApprovedAssets(supabase: SupabaseClient, projectId: string, assetRules: TreasuryAssetRule[]) {
  for (const rule of assetRules) {
    const { data: existingAsset, error: findAssetError } = await supabase
      .from("asset_registry")
      .select("id")
      .eq("symbol", rule.symbol)
      .eq("chain_id", activeChainId)
      .maybeSingle();
    if (findAssetError) throw new Error(findAssetError.message);

    let assetId = existingAsset?.id as string | undefined;
    if (!assetId) {
      const { data: insertedAsset, error: insertAssetError } = await supabase
        .from("asset_registry")
        .insert({ chain_id: activeChainId, contract_address: `pending:${rule.symbol}`, symbol: rule.symbol, name: rule.name, asset_type: rule.type, verification_status: "unverified" })
        .select("id")
        .single();
      if (insertAssetError || !insertedAsset) throw new Error(insertAssetError?.message ?? "Failed to register asset.");
      assetId = insertedAsset.id as string;
    }

    const { error: upsertError } = await supabase.from("project_approved_assets").upsert(
      {
        project_id: projectId,
        asset_id: assetId,
        approved: rule.approved,
        max_allocation_bps: bps(rule.maxAllocation),
        max_single_purchase_usd: rule.maxSinglePurchaseUsd,
        agent_may_recommend: rule.agentMayRecommend,
        automatic_execution: false,
      },
      { onConflict: "project_id,asset_id" },
    );
    if (upsertError) throw new Error(upsertError.message);
  }

  const { data: policyRow, error: policyError } = await supabase
    .from("treasury_policies")
    .select("id, minimum_reserve_bps, maximum_single_asset_bps, maximum_crypto_bps, maximum_trade_bps, require_human_approval, allow_automated_execution")
    .eq("project_id", projectId)
    .maybeSingle();
  if (policyError) throw new Error(policyError.message);
  if (policyRow) {
    const { data: versions } = await supabase.from("treasury_policy_versions").select("version").eq("policy_id", policyRow.id).order("effective_at", { ascending: false }).limit(1);
    const previousVersion = Number.parseFloat(versions?.[0]?.version ?? "1.0");
    const nextVersion = Number.isFinite(previousVersion) ? (previousVersion + 0.1).toFixed(1) : "1.1";
    const { data: newVersion, error: versionError } = await supabase
      .from("treasury_policy_versions")
      .insert({
        policy_id: policyRow.id,
        version: nextVersion,
        minimum_reserve_bps: policyRow.minimum_reserve_bps,
        maximum_single_asset_bps: policyRow.maximum_single_asset_bps,
        maximum_crypto_bps: policyRow.maximum_crypto_bps,
        maximum_trade_bps: policyRow.maximum_trade_bps,
        require_human_approval: policyRow.require_human_approval,
        allow_automated_execution: policyRow.allow_automated_execution,
        summary: "Updated supported assets and Agent recommendation permissions.",
      })
      .select("id")
      .single();
    if (!versionError && newVersion) {
      await supabase.from("treasury_policies").update({ current_version_id: newVersion.id }).eq("id", policyRow.id);
    }
  }
}
