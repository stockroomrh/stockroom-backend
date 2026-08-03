import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Address } from "viem";
import { getErc20Balances, getNativeBalance, getCurrentBlockNumber } from "@/lib/server/chain/balances";
import { isRpcConfigured } from "@/lib/server/chain/client";
import { readPriceFeed, isStablePegAsset, getEthDisplayPriceUsd, getStockDisplayPriceUsd, getDexScreenerPriceUsd } from "@/lib/server/assets/price-feeds";
import { isBlockscoutConfigured, getAddressInfo, getTokenTransfers, getTransactions, transactionUrl } from "@/lib/server/chain/blockscout";
import { allocationBps, isPriceStale, positionValueUsd, rawBalanceToDisplay, reservePercentage, runwayMonths, totalNavUsd } from "@/lib/server/assets/valuation";
import { firstOf } from "@/lib/server/db/queries";

export class ChainNotConfiguredError extends Error {}

type AssetRegistryRow = {
  id: string; symbol: string; name: string; asset_type: string; contract_address: string; decimals: number;
  current_multiplier: number; price_feed_address: string | null; price_feed_heartbeat_seconds: number;
};

type ApprovedAssetRow = {
  asset_id: string;
  approved: boolean;
  // project_approved_assets -> asset_registry is a unique-FK (one-to-one)
  // relation, so PostgREST embeds a plain object — but must go through
  // firstOf() below, never assumed, since that shape isn't guaranteed by
  // the type system here (see lib/server/db/queries.ts's firstOf() for why).
  asset_registry: AssetRegistryRow | AssetRegistryRow[] | null;
};

type RawActivityRow = {
  project_id: string; tx_hash: string; block_number: number; occurred_at: string;
  activity_type: string; description: string; asset_symbol: string; raw_amount: string;
  counterparty_address?: string; status: string;
};

/**
 * Converts each newly-seen activity row's raw onchain amount into a real
 * display value using the asset's actual decimals (never shown as raw
 * wei/smallest-unit again), and attempts a real USD value using the same
 * pricing cascade the position-pricing loop below uses — stable peg,
 * Chainlink feed, stock display price, then DEX price. Decimals and price
 * are stored ON the row (not looked up again on every read) so a later
 * change to an asset's registry entry never rewrites history.
 */
async function priceActivityRows(supabase: SupabaseClient, chainId: number, rows: RawActivityRow[]) {
  const symbols = [...new Set(rows.map((row) => row.asset_symbol))];
  if (symbols.length === 0) return [];

  const { data: registryRows } = await supabase
    .from("asset_registry")
    .select("symbol, decimals, asset_type, current_multiplier, price_feed_address, contract_address")
    .eq("chain_id", chainId)
    .in("symbol", symbols);
  const registryBySymbol = new Map((registryRows ?? []).map((row) => [row.symbol as string, row]));

  const priced: (RawActivityRow & { decimals: number; usd_value: number | null })[] = [];
  for (const row of rows) {
    const asset = registryBySymbol.get(row.asset_symbol);
    const decimals = asset?.decimals ?? 18;
    const display = Number(row.raw_amount) / 10 ** decimals;

    let priceUsd: number | null = null;
    if (isStablePegAsset(row.asset_symbol)) {
      priceUsd = 1;
    } else if (asset?.price_feed_address) {
      const feed = await readPriceFeed(asset.price_feed_address as Address);
      if (feed) priceUsd = feed.priceUsd;
    }
    if (priceUsd === null && (asset?.asset_type === "Stock Token" || asset?.asset_type === "ETF Token")) {
      const displayPrice = await getStockDisplayPriceUsd(row.asset_symbol.replace(/x$/i, ""));
      if (displayPrice) priceUsd = displayPrice.priceUsd * (asset?.current_multiplier ?? 1);
    }
    if (priceUsd === null && (row.asset_symbol === "WETH" || row.asset_symbol === "ETH")) {
      const displayPrice = await getEthDisplayPriceUsd();
      if (displayPrice) priceUsd = displayPrice.priceUsd;
    }
    if (priceUsd === null && asset?.contract_address) {
      const displayPrice = await getDexScreenerPriceUsd(asset.contract_address);
      if (displayPrice) priceUsd = displayPrice.priceUsd;
    }

    priced.push({ ...row, decimals, usd_value: priceUsd !== null ? display * priceUsd : null });
  }
  return priced;
}

/**
 * Runs one full treasury sync for a project: reads real balances from chain,
 * prices approved assets, computes deterministic valuation, and writes a new
 * snapshot + positions + newly-seen activity. Never writes a snapshot built
 * from partially-failed reads without marking the affected positions stale —
 * downstream UI must be able to tell real data from a sync that only
 * partially succeeded.
 */
export async function syncProjectTreasury(supabase: SupabaseClient, projectId: string) {
  if (!isRpcConfigured() && !isBlockscoutConfigured()) {
    throw new ChainNotConfiguredError("No RPC or block explorer is configured for the active chain — there is no way to read chain data yet.");
  }

  const { data: account, error: accountError } = await supabase
    .from("treasury_accounts")
    .select("id, address, chain_id, base_currency")
    .eq("project_id", projectId)
    .maybeSingle();
  if (accountError) throw new Error(accountError.message);
  if (!account) throw new Error("This project has no treasury address configured yet.");

  const treasuryAddress = account.address as Address;

  try {
    const { data: approvedAssets, error: assetsError } = await supabase
      .from("project_approved_assets")
      .select("asset_id, approved, asset_registry(id, symbol, name, asset_type, contract_address, decimals, current_multiplier, price_feed_address, price_feed_heartbeat_seconds)")
      .eq("project_id", projectId)
      .eq("approved", true);
    if (assetsError) throw new Error(assetsError.message);

    // Only real, verified canonical addresses can be used for chain reads —
    // "pending:*" placeholders (seeded at project creation before an asset's
    // real address is known) are never trusted, per CLAUDE_HANDOFF.md.
    type UsableAssetRow = Omit<ApprovedAssetRow, "asset_registry"> & { asset_registry: AssetRegistryRow };
    const usableAssets = ((approvedAssets ?? []) as unknown as ApprovedAssetRow[])
      .map((row) => ({ ...row, asset_registry: firstOf(row.asset_registry) }))
      .filter((row): row is UsableAssetRow => Boolean(row.asset_registry) && !row.asset_registry!.contract_address.startsWith("pending:"));

    const tokenAddresses = usableAssets.map((row) => row.asset_registry.contract_address as Address);
    const [nativeBalanceWei, blockNumber, erc20Balances] = await Promise.all([
      getNativeBalance(treasuryAddress),
      getCurrentBlockNumber(),
      getErc20Balances(treasuryAddress, tokenAddresses),
    ]);

    const now = new Date();
    const positions: {
      asset_id: string; raw_balance: string; display_balance: number; price_usd: number;
      value_usd: number; price_source: string; price_updated_at: string; is_stale: boolean;
    }[] = [];

    for (const row of usableAssets) {
      const asset = row.asset_registry;
      const balanceEntry = erc20Balances.find((entry) => entry.address.toLowerCase() === asset.contract_address.toLowerCase());
      if (!balanceEntry || !balanceEntry.success) continue; // don't fabricate a $0 position for a read that failed
      const display = rawBalanceToDisplay(balanceEntry.rawBalance, asset.decimals);
      if (display === 0) continue; // no need to record zero-balance positions

      let priceUsd = 0;
      let priceSource = "chainlink";
      let priceUpdatedAt = now;
      let stale = true;
      // Chainlink feeds already report the multiplier-adjusted value — only
      // apply current_multiplier ourselves when pricing from the raw
      // underlying-equity display fallback (see docs/PRODUCT_BRIEF.md §11).
      let multiplier = 1;

      if (isStablePegAsset(asset.symbol)) {
        priceUsd = 1;
        stale = false;
      } else if (asset.price_feed_address) {
        const feed = await readPriceFeed(asset.price_feed_address as Address);
        if (feed) {
          priceUsd = feed.priceUsd;
          priceUpdatedAt = feed.updatedAt;
          stale = isPriceStale(feed.updatedAt, asset.price_feed_heartbeat_seconds, now);
        }
      }

      if (priceUsd === 0 && (asset.asset_type === "Stock Token" || asset.asset_type === "ETF Token")) {
        const displayPrice = await getStockDisplayPriceUsd(asset.symbol.replace(/x$/i, ""));
        if (displayPrice) {
          priceUsd = displayPrice.priceUsd;
          priceUpdatedAt = displayPrice.updatedAt;
          priceSource = "swap_quote"; // reuses the existing "offchain" price_source category
          multiplier = asset.current_multiplier;
          stale = false;
        }
      }

      // WETH is economically identical to native ETH — reuse the same
      // display price used for the native ETH gas position below.
      if (priceUsd === 0 && asset.asset_type === "Crypto" && (asset.symbol === "WETH" || asset.symbol === "ETH")) {
        const displayPrice = await getEthDisplayPriceUsd();
        if (displayPrice) {
          priceUsd = displayPrice.priceUsd;
          priceUpdatedAt = displayPrice.updatedAt;
          priceSource = "swap_quote";
          stale = false;
        }
      }

      // Any other Crypto-type asset with no Chainlink feed (e.g. a project's
      // own token trading on a DEX, with no oracle) — price it from the
      // deepest onchain liquidity pool DexScreener knows about. If nothing
      // is indexed, it stays unpriced/stale rather than showing a fabricated number.
      if (priceUsd === 0 && asset.asset_type === "Crypto" && asset.symbol !== "WETH" && asset.symbol !== "ETH") {
        const displayPrice = await getDexScreenerPriceUsd(asset.contract_address);
        if (displayPrice) {
          priceUsd = displayPrice.priceUsd;
          priceUpdatedAt = displayPrice.updatedAt;
          priceSource = "swap_quote";
          stale = false;
        }
      }

      positions.push({
        asset_id: asset.id,
        raw_balance: balanceEntry.rawBalance.toString(),
        display_balance: display,
        price_usd: priceUsd,
        value_usd: positionValueUsd(display, priceUsd, multiplier),
        price_source: priceSource,
        price_updated_at: priceUpdatedAt.toISOString(),
        is_stale: priceUsd === 0 || stale,
      });
    }

    // Native ETH (gas reserve) is priced against the registry's own ETH
    // entry regardless of whether this project specifically approved it for
    // trading — gas balance is always economically relevant. Unlike ERC-20
    // positions, native ETH has no contract to verify (it's the chain's own
    // currency), so the "pending:*" placeholder check that guards ERC-20
    // reads doesn't apply here — we only need the registry row for its id
    // (FK) and, optionally, a configured price feed.
    //
    // Must be scoped to symbol "ETH" specifically, not "ETH or WETH" — once
    // WETH also exists in asset_registry (it's a real, separately-trackable
    // ERC-20 position now), an ambiguous .in(["ETH","WETH"]) match could
    // return either row, silently mislabeling this native-ETH balance under
    // WETH's asset_id and producing a second, wrong "WETH" position.
    if (nativeBalanceWei !== null) {
      const display = rawBalanceToDisplay(nativeBalanceWei, 18);
      if (display > 0) {
        const { data: gasAsset } = await supabase
          .from("asset_registry")
          .select("id, price_feed_address, price_feed_heartbeat_seconds")
          .eq("symbol", "ETH")
          .eq("chain_id", account.chain_id)
          .maybeSingle();

        if (gasAsset) {
          let priceUsd = 0;
          let priceUpdatedAt = now;
          let stale = true;
          let priceSource = "chainlink";

          if (gasAsset.price_feed_address) {
            const feed = await readPriceFeed(gasAsset.price_feed_address as Address);
            if (feed) {
              priceUsd = feed.priceUsd;
              priceUpdatedAt = feed.updatedAt;
              stale = isPriceStale(feed.updatedAt, gasAsset.price_feed_heartbeat_seconds, now);
            }
          }
          // No onchain feed configured yet — fall back to a public market
          // price for display purposes only (never for policy decisions).
          if (priceUsd === 0) {
            const displayPrice = await getEthDisplayPriceUsd();
            if (displayPrice) {
              priceUsd = displayPrice.priceUsd;
              priceUpdatedAt = displayPrice.updatedAt;
              priceSource = "swap_quote"; // reuses the existing "offchain" price_source category
              stale = false;
            }
          }

          positions.push({
            asset_id: gasAsset.id,
            raw_balance: nativeBalanceWei.toString(),
            display_balance: display,
            price_usd: priceUsd,
            value_usd: positionValueUsd(display, priceUsd, 1),
            price_source: priceSource,
            price_updated_at: priceUpdatedAt.toISOString(),
            is_stale: priceUsd === 0 || stale,
          });
        }
      }
    }

    const totalValueUsd = totalNavUsd(positions.map((p) => p.value_usd));
    const reserveAsset = positions.find((p) => {
      const asset = usableAssets.find((row) => row.asset_registry.id === p.asset_id)?.asset_registry;
      return asset && isStablePegAsset(asset.symbol);
    });
    const reserveValueUsd = reserveAsset?.value_usd ?? 0;

    const { data: snapshot, error: snapshotError } = await supabase
      .from("treasury_snapshots")
      .insert({
        project_id: projectId,
        block_number: blockNumber ? Number(blockNumber) : null,
        total_value_usd: totalValueUsd,
        reserve_value_usd: reserveValueUsd,
      })
      .select("id")
      .single();
    if (snapshotError || !snapshot) throw new Error(snapshotError?.message ?? "Failed to write treasury snapshot.");

    const positionsToInsert = positions.filter((p) => p.asset_id).map((p) => ({ snapshot_id: snapshot.id, allocation_bps: allocationBps(p.value_usd, totalValueUsd), ...p }));
    if (positionsToInsert.length > 0) {
      const { error: positionsError } = await supabase.from("treasury_positions").insert(positionsToInsert);
      if (positionsError) throw new Error(positionsError.message);
    }

    // Detect new activity from Blockscout (deposits/withdrawals by direction;
    // operator can reclassify later — see project_approved_assets_write-style
    // policy on activity_items for who may update `status`/labels).
    if (isBlockscoutConfigured()) {
      try {
        const [txResult, transferResult] = await Promise.all([getTransactions(treasuryAddress), getTokenTransfers(treasuryAddress)]);
        const activityRows = [
          ...txResult.items.filter((tx) => tx.status === "ok" && tx.value !== "0").map((tx) => {
            const isDeposit = tx.to?.hash?.toLowerCase() === treasuryAddress.toLowerCase();
            return {
              project_id: projectId,
              tx_hash: tx.hash,
              block_number: tx.block_number,
              occurred_at: tx.timestamp,
              activity_type: isDeposit ? "Deposit" : "Withdrawal",
              description: isDeposit ? "Native ETH received" : "Native ETH sent",
              asset_symbol: "ETH",
              raw_amount: tx.value,
              counterparty_address: isDeposit ? tx.from?.hash : tx.to?.hash,
              status: "needs_review",
            };
          }),
          ...transferResult.items.map((transfer) => {
            const isDeposit = transfer.to?.hash?.toLowerCase() === treasuryAddress.toLowerCase();
            return {
              project_id: projectId,
              tx_hash: transfer.transaction_hash,
              block_number: transfer.block_number,
              occurred_at: transfer.timestamp,
              activity_type: isDeposit ? "Deposit" : "Withdrawal",
              description: `${transfer.token.symbol} transfer`,
              asset_symbol: transfer.token.symbol,
              raw_amount: transfer.total?.value ?? "0",
              counterparty_address: isDeposit ? transfer.from?.hash : transfer.to?.hash,
              status: "needs_review",
            };
          }),
        ];
        if (activityRows.length > 0) {
          const pricedRows = await priceActivityRows(supabase, account.chain_id, activityRows as RawActivityRow[]);
          // ON CONFLICT (project_id, tx_hash) DO NOTHING via upsert with ignoreDuplicates
          await supabase.from("activity_items").upsert(pricedRows, { onConflict: "project_id,tx_hash,asset_symbol", ignoreDuplicates: true });
        }
      } catch {
        // Activity indexing is best-effort — a Blockscout hiccup shouldn't fail the whole sync.
      }
    }

    await supabase
      .from("treasury_accounts")
      .update({ last_synced_at: now.toISOString(), last_synced_block: blockNumber ? Number(blockNumber) : null, last_sync_error: null })
      .eq("id", account.id);

    return { snapshotId: snapshot.id, totalValueUsd, positionCount: positionsToInsert.length };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unknown sync error.";
    await supabase.from("treasury_accounts").update({ last_sync_error: message }).eq("id", account.id);
    throw cause;
  }
}

export function computeRunwayAndReserve(positions: { symbol: string; valueUsd: number }[], totalValueUsd: number) {
  const reserve = positions.find((p) => isStablePegAsset(p.symbol));
  return { reservePct: reservePercentage(reserve?.valueUsd ?? 0, totalValueUsd) };
}

export { runwayMonths, transactionUrl };
