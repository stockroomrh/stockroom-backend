import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { transactionUrl, addressUrl } from "@/lib/server/chain/blockscout";
import { sendTelegramMessage, escapeHtml } from "@/lib/server/telegram/bot-client";

const DAILY_SUMMARY_INTERVAL_MS = 24 * 60 * 60 * 1000;

type ActivityRow = {
  id: string;
  activity_type: string;
  asset_symbol: string | null;
  raw_amount: string | null;
  usd_value: number | null;
  tx_hash: string | null;
  counterparty_address: string | null;
  occurred_at: string;
  created_at: string;
};

function formatActivityAlert(row: ActivityRow, projectName: string): string {
  const verb = row.activity_type === "Deposit" ? "received" : "sent";
  const amount = row.raw_amount ?? "?";
  const asset = row.asset_symbol ?? "?";
  const usd = row.usd_value != null ? ` (~$${row.usd_value.toLocaleString(undefined, { maximumFractionDigits: 2 })})` : "";
  const wallet = row.counterparty_address ? `\n${row.activity_type === "Deposit" ? "From" : "To"}: <a href="${addressUrl(row.counterparty_address)}">${row.counterparty_address.slice(0, 8)}…${row.counterparty_address.slice(-6)}</a>` : "";
  const txLink = row.tx_hash ? `\n<a href="${transactionUrl(row.tx_hash)}">View transaction ↗</a>` : "";
  return `${row.activity_type === "Deposit" ? "🟢" : "🔴"} <b>${escapeHtml(projectName)}</b> ${verb} ${amount} ${asset}${usd}${wallet}${txLink}`;
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

      const sinceIso = link.last_alerted_activity_at ?? new Date(0).toISOString();
      const { data: newActivity, error: activityError } = await service
        .from("activity_items")
        .select("id, activity_type, asset_symbol, raw_amount, usd_value, tx_hash, counterparty_address, occurred_at, created_at")
        .eq("project_id", link.project_id)
        .in("activity_type", ["Deposit", "Withdrawal"])
        .gt("created_at", sinceIso)
        .order("created_at", { ascending: true });
      if (activityError) throw new Error(activityError.message);

      let latestCreatedAt = link.last_alerted_activity_at;
      for (const row of (newActivity ?? []) as ActivityRow[]) {
        const sendResult = await sendTelegramMessage(link.chat_id, formatActivityAlert(row, projectName));
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
