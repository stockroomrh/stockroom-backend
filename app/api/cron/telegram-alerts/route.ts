import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { transactionUrl, addressUrl } from "@/lib/server/chain/blockscout";
import { sendTelegramMessage, escapeHtml } from "@/lib/server/telegram/bot-client";
import { reservePercentage } from "@/lib/server/assets/valuation";
import { syncProjectTreasury, ChainNotConfiguredError } from "@/lib/server/db/treasury-sync";

// Real on-chain sync per linked project now happens here, on this same
// 5-minute poll (see .github/workflows/telegram-alerts.yml) — previously
// activity_items only got fresh rows when an operator manually clicked
// "Sync" in the dashboard, so a deposit could sit undetected indefinitely
// if nobody happened to have the app open.
export const maxDuration = 60;

const DAILY_SUMMARY_INTERVAL_MS = 24 * 60 * 60 * 1000;

type ActivityRow = {
  id: string;
  activity_type: string;
  asset_symbol: string | null;
  raw_amount: string | null;
  decimals: number | null;
  usd_value: number | null;
  tx_hash: string | null;
  counterparty_address: string | null;
  occurred_at: string;
  created_at: string;
};

type TreasuryImpact = {
  minimumReserveBps: number;
  before: { valueUsd: number; reservePct: number } | null;
  after: { valueUsd: number; reservePct: number } | null;
};

/** Never scientific notation, never raw wei — same rule as the web dashboard's activity feed. */
function formatTokenDisplayAmount(rawAmount: string | null, decimals: number | null): string {
  if (!rawAmount) return "0";
  const value = Number(rawAmount) / 10 ** (decimals ?? 18);
  if (!Number.isFinite(value) || value === 0) return "0";
  const maximumFractionDigits = value < 1 ? 6 : value < 1000 ? 4 : 2;
  return value.toLocaleString(undefined, { maximumFractionDigits, minimumFractionDigits: 0 });
}

function formatActivityAlert(row: ActivityRow, projectName: string, impact: TreasuryImpact): string {
  const verb = row.activity_type === "Deposit" ? "detected" : "sent";
  const amount = formatTokenDisplayAmount(row.raw_amount, row.decimals);
  const asset = row.asset_symbol ?? "?";
  const usd = row.usd_value != null ? ` · $${Math.abs(row.usd_value).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "";
  const wallet = row.counterparty_address ? `\n${row.activity_type === "Deposit" ? "From" : "To"}: <a href="${addressUrl(row.counterparty_address)}">${row.counterparty_address.slice(0, 8)}…${row.counterparty_address.slice(-6)}</a>` : "";
  const txLink = row.tx_hash ? `\n<a href="${transactionUrl(row.tx_hash)}">View transaction ↗</a>` : "";

  let impactLines = "";
  if (impact.before && impact.after) {
    const fmt = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    impactLines = `\n\nTreasury value: ${fmt(impact.before.valueUsd)} → ${fmt(impact.after.valueUsd)}\nReserve coverage: ${impact.before.reservePct}% → ${impact.after.reservePct}%`;
    const target = impact.minimumReserveBps / 100;
    if (impact.after.reservePct < target) {
      impactLines += `\n\nThis remains below the ${target}% reserve target.`;
    } else if (impact.before.reservePct < target && impact.after.reservePct >= target) {
      impactLines += `\n\nThis brings the treasury back to its ${target}% reserve target.`;
    }
  }

  return `${row.activity_type === "Deposit" ? "🟢 Treasury deposit" : "🔴 Treasury withdrawal"} ${verb}\n<b>${escapeHtml(projectName)}</b>\n${row.activity_type === "Deposit" ? "Received" : "Sent"}: ${amount} ${asset}${usd}${wallet}${impactLines}${txLink}`;
}

// Polled on a schedule (see vercel.json) rather than triggered by any single
// user action — checks every linked chat for new deposit/withdrawal activity
// since it last alerted, and sends a daily summary once every 24h if enabled.
// Same CRON_SECRET pattern as the weekly report.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const service = getSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "Live mode is not configured yet." }, { status: 503 });

  const { data: links, error } = await service.from("telegram_links").select("id, project_id, chat_id, daily_summary_enabled, last_alerted_activity_at, last_daily_summary_sent_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: { chatId: string; alertsSent: number; summarySent: boolean; error?: string }[] = [];

  for (const link of links ?? []) {
    let alertsSent = 0;
    let summarySent = false;
    try {
      const { data: project } = await service.from("projects").select("name").eq("id", link.project_id).maybeSingle();
      const projectName = project?.name ?? "Project";

      try {
        await syncProjectTreasury(service, link.project_id);
      } catch (syncCause) {
        // A stale read for this one project must never block alerting for
        // the rest, or for whatever was already indexed for this project.
        if (!(syncCause instanceof ChainNotConfiguredError)) throw syncCause;
      }

      const sinceIso = link.last_alerted_activity_at ?? new Date(0).toISOString();
      const { data: newActivity, error: activityError } = await service
        .from("activity_items")
        .select("id, activity_type, asset_symbol, raw_amount, decimals, usd_value, tx_hash, counterparty_address, occurred_at, created_at")
        .eq("project_id", link.project_id)
        .in("activity_type", ["Deposit", "Withdrawal"])
        .gt("created_at", sinceIso)
        .order("created_at", { ascending: true });
      if (activityError) throw new Error(activityError.message);

      // Real before/after treasury impact — the two most recent snapshots
      // bracket whatever activity happened since the last sync. Same pair
      // is used for every new item in this batch (snapshot granularity is
      // per-sync, not per-transaction) rather than fabricating a number.
      let impact: TreasuryImpact = { minimumReserveBps: 6000, before: null, after: null };
      if ((newActivity ?? []).length > 0) {
        const [{ data: recentSnapshots }, { data: policyRow }] = await Promise.all([
          service.from("treasury_snapshots").select("total_value_usd, reserve_value_usd").eq("project_id", link.project_id).order("captured_at", { ascending: false }).limit(2),
          service.from("treasury_policies").select("minimum_reserve_bps").eq("project_id", link.project_id).maybeSingle(),
        ]);
        const [after, before] = recentSnapshots ?? [];
        impact = {
          minimumReserveBps: policyRow?.minimum_reserve_bps ?? 6000,
          after: after ? { valueUsd: Number(after.total_value_usd), reservePct: reservePercentage(Number(after.reserve_value_usd), Number(after.total_value_usd)) } : null,
          before: before ? { valueUsd: Number(before.total_value_usd), reservePct: reservePercentage(Number(before.reserve_value_usd), Number(before.total_value_usd)) } : null,
        };
      }

      let latestCreatedAt = link.last_alerted_activity_at;
      for (const row of (newActivity ?? []) as ActivityRow[]) {
        const sendResult = await sendTelegramMessage(link.chat_id, formatActivityAlert(row, projectName, impact));
        if (sendResult.ok) alertsSent++;
        latestCreatedAt = row.created_at;
      }
      if (latestCreatedAt !== link.last_alerted_activity_at) {
        await service.from("telegram_links").update({ last_alerted_activity_at: latestCreatedAt }).eq("id", link.id);
      }

      const lastSummary = link.last_daily_summary_sent_at ? new Date(link.last_daily_summary_sent_at).getTime() : 0;
      if (link.daily_summary_enabled && Date.now() - lastSummary >= DAILY_SUMMARY_INTERVAL_MS) {
        const { data: snapshot } = await service
          .from("treasury_snapshots")
          .select("total_value_usd, reserve_value_usd")
          .eq("project_id", link.project_id)
          .order("captured_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const value = snapshot?.total_value_usd ?? null;
        const text = value != null
          ? `📊 <b>${escapeHtml(projectName)}</b> daily summary\nTreasury value: $${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
          : `📊 <b>${escapeHtml(projectName)}</b> daily summary\nNo treasury snapshot indexed yet.`;
        const summaryResult = await sendTelegramMessage(link.chat_id, text);
        if (summaryResult.ok) {
          summarySent = true;
          await service.from("telegram_links").update({ last_daily_summary_sent_at: new Date().toISOString() }).eq("id", link.id);
        }
      }

      results.push({ chatId: link.chat_id, alertsSent, summarySent });
    } catch (cause) {
      // One chat's failure (bad token, chat deleted, etc.) must never stop the rest.
      results.push({ chatId: link.chat_id, alertsSent, summarySent, error: cause instanceof Error ? cause.message : "Unknown error" });
    }
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), chatCount: results.length, results });
}
