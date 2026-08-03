import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { getProjectPolicy, getProjectRowBySlug, getTreasuryData, mapProject } from "@/lib/server/db/queries";
import { sendTelegramMessage, escapeHtml } from "@/lib/server/telegram/bot-client";

type TelegramUpdate = {
  message?: {
    chat: { id: number; type: string; title?: string; first_name?: string; username?: string };
    text?: string;
  };
};

async function handleStart(service: NonNullable<ReturnType<typeof getSupabaseServiceClient>>, chatId: string, chatTitle: string, code: string) {
  const { data: linkCode, error } = await service
    .from("telegram_link_codes")
    .select("id, project_id, expires_at, used_at")
    .eq("code", code)
    .maybeSingle();
  if (error || !linkCode) return sendTelegramMessage(chatId, "That code isn't valid. Generate a new one from the project's Operator Console.");
  if (linkCode.used_at) return sendTelegramMessage(chatId, "That code has already been used. Generate a new one from the Operator Console.");
  if (new Date(linkCode.expires_at).getTime() < Date.now()) return sendTelegramMessage(chatId, "That code has expired. Generate a new one from the Operator Console.");

  const { data: project } = await service.from("projects").select("slug, name").eq("id", linkCode.project_id).maybeSingle();
  if (!project) return sendTelegramMessage(chatId, "Couldn't find the project for that code.");

  const { error: linkError } = await service
    .from("telegram_links")
    .upsert({ project_id: linkCode.project_id, chat_id: chatId, chat_title: chatTitle, updated_at: new Date().toISOString() }, { onConflict: "project_id" });
  if (linkError) return sendTelegramMessage(chatId, "Linking failed — try again from the Operator Console.");

  await service.from("telegram_link_codes").update({ used_at: new Date().toISOString() }).eq("id", linkCode.id);

  return sendTelegramMessage(chatId, `✅ This chat is now linked to <b>${escapeHtml(project.name)}</b>. You'll get alerts here for real deposits and withdrawals. Try /treasury for the current balance.`);
}

function healthExplanation(health: string, reserve: number, target: number): string {
  if (health === "AT RISK") return `Reserve is ${Math.max(0, target - reserve).toFixed(0)}pp below the ${target}% target — the policy engine will block most new buys until this improves.`;
  if (health === "WATCH") return `Reserve is close to the ${target}% target but not there yet — worth monitoring.`;
  return `Reserve is at or above the ${target}% target.`;
}

async function handleTreasuryCommand(service: NonNullable<ReturnType<typeof getSupabaseServiceClient>>, chatId: string) {
  const { data: link } = await service.from("telegram_links").select("project_id").eq("chat_id", chatId).maybeSingle();
  if (!link) return sendTelegramMessage(chatId, "This chat isn't linked to a project yet. Generate a link code from that project's Operator Console, then send /start &lt;code&gt; here.");

  const { data: project } = await service.from("projects").select("slug, name").eq("id", link.project_id).maybeSingle();
  if (!project) return sendTelegramMessage(chatId, "Linked project could not be found.");

  const policy = await getProjectPolicy(service, link.project_id);
  if (!policy) return sendTelegramMessage(chatId, "This project has no treasury policy configured yet.");
  const { summary, activity } = await getTreasuryData(service, link.project_id, policy);

  if (!summary) return sendTelegramMessage(chatId, `<b>${escapeHtml(project.name)}</b> Treasury\nNo treasury snapshot indexed yet.`);

  const recent = activity
    .filter((item) => item.type === "Deposit" || item.type === "Withdrawal")
    .slice(0, 5)
    .map((item) => `${item.type === "Deposit" ? "↓ Deposited" : "↑ Withdrew"} ${item.amount} ${item.asset} · ${item.usdValue}`)
    .join("\n");

  const baseUrl = `https://stockroom.finance/app/project/${project.slug}`;
  const text = [
    `<b>${escapeHtml(project.name)} Treasury</b>`,
    ``,
    `Total value: $${summary.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
    `Reserve ratio: ${summary.reserve}% / ${summary.reserveTarget}% target`,
    `Treasury health: ${summary.health === "AT RISK" ? "At risk" : summary.health === "WATCH" ? "Watch" : "Healthy"}`,
    healthExplanation(summary.health, summary.reserve, summary.reserveTarget),
    ``,
    `<b>Recent activity</b>`,
    recent || "No recent deposits or withdrawals.",
    ``,
    `<a href="${baseUrl}/treasury">View treasury ↗</a> · <a href="${baseUrl}/activity">View transactions ↗</a>`,
  ].join("\n");

  return sendTelegramMessage(chatId, text);
}

// Telegram calls this for every message the bot receives (set via
// setWebhook). Verified via the secret token Telegram echoes back on every
// request — anyone without it gets rejected before we touch the DB.
export async function POST(request: Request) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret) return NextResponse.json({ error: "Telegram webhook is not configured." }, { status: 503 });
  if (request.headers.get("x-telegram-bot-api-secret-token") !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const service = getSupabaseServiceClient();
  if (!service) return NextResponse.json({ ok: true }); // nothing to do without live mode, but still ack Telegram

  const update = (await request.json().catch(() => null)) as TelegramUpdate | null;
  const message = update?.message;
  if (!message?.text) return NextResponse.json({ ok: true });

  const chatId = String(message.chat.id);
  const chatTitle = message.chat.title ?? message.chat.username ?? message.chat.first_name ?? "Telegram chat";
  const text = message.text.trim();

  try {
    if (text.startsWith("/start ")) {
      await handleStart(service, chatId, chatTitle, text.slice("/start ".length).trim());
    } else if (text.startsWith("/link ")) {
      await handleStart(service, chatId, chatTitle, text.slice("/link ".length).trim());
    } else if (text === "/treasury") {
      await handleTreasuryCommand(service, chatId);
    } else if (text === "/start") {
      await sendTelegramMessage(chatId, "Link this chat to a project from its Operator Console — it'll give you a code to paste here as /start &lt;code&gt;.");
    }
  } catch {
    // A single malformed update must never take the webhook down — Telegram
    // will just move on to the next message.
  }

  return NextResponse.json({ ok: true });
}
