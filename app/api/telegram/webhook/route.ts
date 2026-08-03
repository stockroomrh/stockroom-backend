import { NextResponse, after } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { getProjectPolicy, getTreasuryData } from "@/lib/server/db/queries";
import { generateAndStoreAgentReport, getRecommendationsForProject } from "@/lib/server/db/agent-reports";
import { generateAndStorePlan } from "@/lib/server/db/treasury-plans";
import { answerTelegramQuestion } from "@/lib/server/ai/telegram-qa-service";
import { simulateSpend, type SpendSimulation } from "@/lib/server/telegram/simulate-spend";
import {
  sendTelegramMessage,
  editTelegramMessage,
  answerCallbackQuery,
  escapeHtml,
  type InlineKeyboardMarkup,
  type ReplyKeyboardMarkup,
} from "@/lib/server/telegram/bot-client";

// AI calls (brief, questions, plans) can take well over Telegram's own
// patience for a webhook response — handled by acking immediately and doing
// the real work in after(), not by holding this request open.
export const maxDuration = 60;

type Service = NonNullable<ReturnType<typeof getSupabaseServiceClient>>;

type TelegramUpdate = {
  message?: {
    chat: { id: number; type: string; title?: string; first_name?: string; username?: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat: { id: number }; message_id: number };
  };
};

type LinkedProject = { projectId: string; projectSlug: string; projectName: string; actorProfileId: string | null };

// --- Keyboards -------------------------------------------------------------

const MAIN_MENU_KEYBOARD: ReplyKeyboardMarkup = {
  keyboard: [
    [{ text: "📊 Treasury" }, { text: "🧠 Brief" }],
    [{ text: "💸 Simulate" }, { text: "🗂 Plan" }],
    [{ text: "❓ Ask AI" }, { text: "ℹ️ Help" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

function treasuryKeyboard(slug: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "🔄 Refresh", callback_data: "treasury:refresh" }, { text: "🧠 Brief", callback_data: "brief:new" }],
      [{ text: "📈 View treasury ↗", url: `https://stockroom.finance/app/project/${slug}/treasury` }],
      [{ text: "🧾 View activity ↗", url: `https://stockroom.finance/app/project/${slug}/activity` }],
    ],
  };
}

function briefKeyboard(): InlineKeyboardMarkup {
  return { inline_keyboard: [[{ text: "🔄 New brief", callback_data: "brief:new" }, { text: "📊 Treasury", callback_data: "treasury:refresh" }]] };
}

function planKeyboard(slug: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "📂 Open in Stockroom ↗", url: `https://stockroom.finance/app/dashboard/projects/${slug}/operator` }],
      [{ text: "➕ New plan", callback_data: "plan:new" }],
    ],
  };
}

function qaKeyboard(): InlineKeyboardMarkup {
  return { inline_keyboard: [[{ text: "❓ Ask another", callback_data: "qa:new" }, { text: "📊 Treasury", callback_data: "treasury:refresh" }]] };
}

function simulatePresetKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "$1,000", callback_data: "sim:1000" }, { text: "$5,000", callback_data: "sim:5000" }, { text: "$10,000", callback_data: "sim:10000" }],
      [{ text: "$25,000", callback_data: "sim:25000" }, { text: "$50,000", callback_data: "sim:50000" }],
    ],
  };
}

function helpKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "📊 Treasury", callback_data: "treasury:refresh" }, { text: "🧠 Brief", callback_data: "brief:new" }],
      [{ text: "💸 Simulate", callback_data: "sim:menu" }, { text: "🗂 New plan", callback_data: "plan:new" }],
    ],
  };
}

const SIMULATE_HELP_TEXT = `<b>💸 Spend simulation</b>\n\nPick a preset below, or type your own:\n<code>/simulate spend 2000 marketing</code>`;
const PLAN_HELP_TEXT = `<b>🗂 Create a staged plan</b>\n\nDescribe what you want the treasury to achieve, e.g.:\n<code>/plan build a $10,000 marketing reserve over the next month</code>`;
const HELP_TEXT = `<b>Stockroom Treasury Operator</b>\n\nTap a button below, or use these commands:\n\n📊 /treasury — current status\n🧠 /brief — AI daily summary\n💸 /simulate spend &lt;amount&gt; &lt;label&gt; — test a hypothetical expense\n🗂 /plan &lt;objective&gt; — build a staged treasury plan\n❓ Just type a question — answered with real treasury data`;

// --- Linking -----------------------------------------------------------------

async function getLinkedProject(service: Service, chatId: string): Promise<LinkedProject | null> {
  const { data: link } = await service.from("telegram_links").select("project_id, linked_by").eq("chat_id", chatId).maybeSingle();
  if (!link) return null;
  const { data: project } = await service.from("projects").select("slug, name").eq("id", link.project_id).maybeSingle();
  if (!project) return null;
  return { projectId: link.project_id, projectSlug: project.slug, projectName: project.name, actorProfileId: link.linked_by };
}

const NOT_LINKED_MESSAGE = "This chat isn't linked to a project yet. Generate a link code from that project's Operator Console, then send /start &lt;code&gt; here.";

async function handleStart(service: Service, chatId: string, chatTitle: string, code: string) {
  const { data: linkCode, error } = await service
    .from("telegram_link_codes")
    .select("id, project_id, created_by, expires_at, used_at")
    .eq("code", code)
    .maybeSingle();
  if (error || !linkCode) return sendTelegramMessage(chatId, "That code isn't valid. Generate a new one from the project's Operator Console.");
  if (linkCode.used_at) return sendTelegramMessage(chatId, "That code has already been used. Generate a new one from the Operator Console.");
  if (new Date(linkCode.expires_at).getTime() < Date.now()) return sendTelegramMessage(chatId, "That code has expired. Generate a new one from the Operator Console.");

  const { data: project } = await service.from("projects").select("slug, name").eq("id", linkCode.project_id).maybeSingle();
  if (!project) return sendTelegramMessage(chatId, "Couldn't find the project for that code.");

  const { error: linkError } = await service
    .from("telegram_links")
    .upsert({ project_id: linkCode.project_id, chat_id: chatId, chat_title: chatTitle, linked_by: linkCode.created_by, updated_at: new Date().toISOString() }, { onConflict: "project_id" });
  if (linkError) return sendTelegramMessage(chatId, "Linking failed — try again from the Operator Console.");

  await service.from("telegram_link_codes").update({ used_at: new Date().toISOString() }).eq("id", linkCode.id);

  return sendTelegramMessage(
    chatId,
    `✅ This chat is now linked to <b>${escapeHtml(project.name)}</b>. You'll get alerts here for real deposits and withdrawals.\n\nUse the menu below to get started 👇`,
    MAIN_MENU_KEYBOARD,
  );
}

// --- /treasury ---------------------------------------------------------------

function healthExplanation(health: string, reserve: number, target: number): string {
  if (health === "AT RISK") return `Reserve is ${Math.max(0, target - reserve).toFixed(0)}pp below the ${target}% target — the policy engine will block most new buys until this improves.`;
  if (health === "WATCH") return `Reserve is close to the ${target}% target but not there yet — worth monitoring.`;
  return `Reserve is at or above the ${target}% target.`;
}

async function buildTreasuryCard(service: Service, linked: LinkedProject): Promise<{ text: string; keyboard?: InlineKeyboardMarkup }> {
  const policy = await getProjectPolicy(service, linked.projectId);
  if (!policy) return { text: "This project has no treasury policy configured yet." };
  const { summary, activity } = await getTreasuryData(service, linked.projectId, policy);
  if (!summary) return { text: `<b>${escapeHtml(linked.projectName)}</b> Treasury\nNo treasury snapshot indexed yet.` };

  const recent = activity
    .filter((item) => item.type === "Deposit" || item.type === "Withdrawal")
    .slice(0, 5)
    .map((item) => `${item.type === "Deposit" ? "↓ Deposited" : "↑ Withdrew"} ${item.amount} ${item.asset} · ${item.usdValue}`)
    .join("\n");

  const text = [
    `<b>${escapeHtml(linked.projectName)} Treasury</b>`,
    ``,
    `Total value: $${summary.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
    `Reserve ratio: ${summary.reserve}% / ${summary.reserveTarget}% target`,
    `Treasury health: ${summary.health === "AT RISK" ? "🔴 At risk" : summary.health === "WATCH" ? "🟡 Watch" : "🟢 Healthy"}`,
    healthExplanation(summary.health, summary.reserve, summary.reserveTarget),
    ``,
    `<b>Recent activity</b>`,
    recent || "No recent deposits or withdrawals.",
  ].join("\n");

  return { text, keyboard: treasuryKeyboard(linked.projectSlug) };
}

async function handleTreasuryCommand(service: Service, chatId: string, editMessageId?: number) {
  const linked = await getLinkedProject(service, chatId);
  if (!linked) return sendTelegramMessage(chatId, NOT_LINKED_MESSAGE);
  const card = await buildTreasuryCard(service, linked);
  if (editMessageId) return editTelegramMessage(chatId, editMessageId, card.text, card.keyboard);
  return sendTelegramMessage(chatId, card.text, card.keyboard);
}

// --- /brief --------------------------------------------------------------

async function handleBriefCommand(service: Service, chatId: string, editMessageId?: number) {
  const linked = await getLinkedProject(service, chatId);
  if (!linked) return sendTelegramMessage(chatId, NOT_LINKED_MESSAGE);
  if (!linked.actorProfileId) return sendTelegramMessage(chatId, "This chat was linked before /brief existed — re-link it from the Operator Console to enable AI commands.");

  const placeholder = "🧠 Generating your treasury brief — this takes about a minute...";
  const trackedId = editMessageId
    ? ((await editTelegramMessage(chatId, editMessageId, placeholder)).ok ? editMessageId : null)
    : (await sendTelegramMessage(chatId, placeholder))?.messageId ?? null;

  after(async () => {
    try {
      const { report } = await generateAndStoreAgentReport(service, linked.projectId, linked.projectSlug, linked.actorProfileId as string);
      const findings = report.findings.slice(0, 3).map((f) => `• ${f}`).join("\n");
      const warnings = report.warnings.slice(0, 2).map((w) => `⚠️ ${w}`).join("\n");
      const text = [
        `<b>Stockroom Daily Brief</b> — ${escapeHtml(linked.projectName)}`,
        ``,
        `Health: ${report.health}`,
        report.summary,
        findings ? `\n<b>Findings</b>\n${findings}` : "",
        warnings ? `\n${warnings}` : "",
        `\n${report.policyValidation}`,
      ].filter(Boolean).join("\n");
      if (trackedId) await editTelegramMessage(chatId, trackedId, text, briefKeyboard());
      else await sendTelegramMessage(chatId, text, briefKeyboard());
    } catch (cause) {
      const errText = `Couldn't generate a brief right now: ${cause instanceof Error ? cause.message : "unknown error"}`;
      if (trackedId) await editTelegramMessage(chatId, trackedId, errText);
      else await sendTelegramMessage(chatId, errText);
    }
  });
}

// --- /simulate -----------------------------------------------------------

function formatSimulationText(label: string, sim: SpendSimulation): string {
  const fmt = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const lines = [
    `<b>💸 ${escapeHtml(label)} spend simulation</b>`,
    ``,
    `Treasury before: ${fmt(sim.before.valueUsd)}`,
    `Treasury after: ${fmt(sim.after.valueUsd)}`,
    `Reserve ratio: ${sim.before.reservePct}% → ${sim.after.reservePct}%`,
    ``,
    `Policy result: <b>${sim.blocked ? "🔴 Blocked" : "🟢 Would pass"}</b>`,
  ];
  if (sim.blocked) {
    lines.push(`Reason: reserve coverage would fall below the ${sim.targetPct}% target.`);
    lines.push(``, `Safer alternative: spend up to ${fmt(sim.maxAffordableUsd)} now while staying at the ${sim.targetPct}% reserve target.`);
  } else {
    lines.push(`This stays at or above the ${sim.targetPct}% reserve target.`);
  }
  lines.push(``, `<i>This is a simulation only — nothing was proposed or executed.</i>`);
  return lines.join("\n");
}

async function handleSimulateAmount(service: Service, chatId: string, amountUsd: number, label: string, editMessageId?: number) {
  const linked = await getLinkedProject(service, chatId);
  if (!linked) return sendTelegramMessage(chatId, NOT_LINKED_MESSAGE);
  const policy = await getProjectPolicy(service, linked.projectId);
  if (!policy) return sendTelegramMessage(chatId, "This project has no treasury policy configured yet.");
  const { data: snapshot } = await service
    .from("treasury_snapshots")
    .select("total_value_usd, reserve_value_usd")
    .eq("project_id", linked.projectId)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!snapshot) return sendTelegramMessage(chatId, "No treasury snapshot indexed yet — nothing to simulate against.");

  const sim = simulateSpend(Number(snapshot.total_value_usd), Number(snapshot.reserve_value_usd), Math.round(policy.minimumReserve * 100), amountUsd);
  const text = formatSimulationText(label, sim);
  const keyboard = simulatePresetKeyboard();
  if (editMessageId) return editTelegramMessage(chatId, editMessageId, text, keyboard);
  return sendTelegramMessage(chatId, text, keyboard);
}

async function handleSimulateCommand(service: Service, chatId: string, rest: string) {
  const match = rest.match(/^spend\s+\$?([\d,]+(?:\.\d+)?)\s+(?:on\s+)?(.+)$/i);
  if (!match) return sendTelegramMessage(chatId, "Usage: /simulate spend 2000 marketing");
  const amountUsd = Number(match[1].replace(/,/g, ""));
  const label = match[2].trim();
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return sendTelegramMessage(chatId, "That doesn't look like a valid amount.");
  return handleSimulateAmount(service, chatId, amountUsd, label);
}

// --- /plan -----------------------------------------------------------------

async function handlePlanCommand(service: Service, chatId: string, objective: string) {
  const linked = await getLinkedProject(service, chatId);
  if (!linked) return sendTelegramMessage(chatId, NOT_LINKED_MESSAGE);
  if (!linked.actorProfileId) return sendTelegramMessage(chatId, "This chat was linked before /plan existed — re-link it from the Operator Console to enable AI commands.");
  if (!objective.trim()) return sendTelegramMessage(chatId, PLAN_HELP_TEXT);

  const ack = await sendTelegramMessage(chatId, "🧠 Building a staged plan for that — this takes about a minute...");
  const trackedId = ack?.messageId ?? null;

  after(async () => {
    try {
      const plan = await generateAndStorePlan(service, linked.projectId, linked.projectSlug, linked.actorProfileId as string, objective.trim());
      const steps = plan.steps.slice(0, 6).map((step, i) => `${i + 1}. ${step.recommendation.title} — ${step.condition}`).join("\n");
      const text = [
        `<b>🗂 Staged plan created</b>`,
        `Objective: ${escapeHtml(objective.trim())}`,
        ``,
        steps || "No steps were proposed — the treasury may already satisfy this objective, or nothing approved fits it.",
        ``,
        `Nothing executes automatically — review and approve each step from the Operator Console.`,
      ].join("\n");
      if (trackedId) await editTelegramMessage(chatId, trackedId, text, planKeyboard(linked.projectSlug));
      else await sendTelegramMessage(chatId, text, planKeyboard(linked.projectSlug));
    } catch (cause) {
      const errText = `Couldn't build that plan right now: ${cause instanceof Error ? cause.message : "unknown error"}`;
      if (trackedId) await editTelegramMessage(chatId, trackedId, errText);
      else await sendTelegramMessage(chatId, errText);
    }
  });
}

// --- Free-text Q&A -----------------------------------------------------------

async function handleQuestion(service: Service, chatId: string, question: string) {
  const linked = await getLinkedProject(service, chatId);
  if (!linked) return sendTelegramMessage(chatId, NOT_LINKED_MESSAGE);
  const policy = await getProjectPolicy(service, linked.projectId);
  if (!policy) return sendTelegramMessage(chatId, "This project has no treasury policy configured yet.");

  const ack = await sendTelegramMessage(chatId, "🤔 Thinking...");
  const trackedId = ack?.messageId ?? null;

  after(async () => {
    try {
      const { summary, positions, activity } = await getTreasuryData(service, linked.projectId, policy);
      const openRecommendations = await getRecommendationsForProject(service, linked.projectId, linked.projectSlug, policy.humanApproval);
      const answer = await answerTelegramQuestion({ projectName: linked.projectName, question, summary, positions, activity, policy, openRecommendations });
      const text = escapeHtml(answer);
      if (trackedId) await editTelegramMessage(chatId, trackedId, text, qaKeyboard());
      else await sendTelegramMessage(chatId, text, qaKeyboard());
    } catch (cause) {
      const errText = `Couldn't answer that right now: ${cause instanceof Error ? cause.message : "unknown error"}`;
      if (trackedId) await editTelegramMessage(chatId, trackedId, errText);
      else await sendTelegramMessage(chatId, errText);
    }
  });
}

// --- Callback (button) handling -----------------------------------------------

async function handleCallbackQuery(service: Service, callback: NonNullable<TelegramUpdate["callback_query"]>) {
  const chatId = callback.message ? String(callback.message.chat.id) : null;
  const messageId = callback.message?.message_id;
  const data = callback.data ?? "";

  if (!chatId || !messageId) {
    await answerCallbackQuery(callback.id);
    return;
  }

  try {
    if (data === "treasury:refresh") {
      await answerCallbackQuery(callback.id, "Refreshed");
      await handleTreasuryCommand(service, chatId, messageId);
    } else if (data === "brief:new") {
      await answerCallbackQuery(callback.id, "Generating...");
      await handleBriefCommand(service, chatId, messageId);
    } else if (data === "plan:new") {
      await answerCallbackQuery(callback.id);
      await sendTelegramMessage(chatId, PLAN_HELP_TEXT);
    } else if (data === "qa:new") {
      await answerCallbackQuery(callback.id);
      await sendTelegramMessage(chatId, "Type your question below and I'll answer using real treasury data 👇");
    } else if (data === "sim:menu") {
      await answerCallbackQuery(callback.id);
      await editTelegramMessage(chatId, messageId, SIMULATE_HELP_TEXT, simulatePresetKeyboard());
    } else if (data.startsWith("sim:")) {
      await answerCallbackQuery(callback.id);
      const amount = Number(data.slice("sim:".length));
      if (Number.isFinite(amount) && amount > 0) await handleSimulateAmount(service, chatId, amount, "expense", messageId);
    } else {
      await answerCallbackQuery(callback.id);
    }
  } catch {
    await answerCallbackQuery(callback.id, "Something went wrong.");
  }
}

// --- Entry point ---------------------------------------------------------

// Telegram calls this for every message/button tap the bot receives (set via
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

  if (update?.callback_query) {
    try {
      await handleCallbackQuery(service, update.callback_query);
    } catch {
      // A single malformed callback must never take the webhook down.
    }
    return NextResponse.json({ ok: true });
  }

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
    } else if (text === "/start") {
      await sendTelegramMessage(chatId, "Link this chat to a project from its Operator Console — it'll give you a code to paste here as /start &lt;code&gt;.");
    } else if (text === "/treasury" || text === "📊 Treasury") {
      await handleTreasuryCommand(service, chatId);
    } else if (text === "/brief" || text === "🧠 Brief") {
      await handleBriefCommand(service, chatId);
    } else if (text.startsWith("/simulate ")) {
      await handleSimulateCommand(service, chatId, text.slice("/simulate ".length).trim());
    } else if (text === "💸 Simulate") {
      await sendTelegramMessage(chatId, SIMULATE_HELP_TEXT, simulatePresetKeyboard());
    } else if (text.startsWith("/plan ")) {
      await handlePlanCommand(service, chatId, text.slice("/plan ".length).trim());
    } else if (text === "🗂 Plan") {
      await sendTelegramMessage(chatId, PLAN_HELP_TEXT);
    } else if (text === "❓ Ask AI") {
      await sendTelegramMessage(chatId, "Type your question below and I'll answer using real treasury data 👇");
    } else if (text === "/help" || text === "/menu" || text === "ℹ️ Help") {
      await sendTelegramMessage(chatId, HELP_TEXT, MAIN_MENU_KEYBOARD);
      await sendTelegramMessage(chatId, "Or tap here:", helpKeyboard());
    } else if (text.startsWith("/")) {
      await sendTelegramMessage(chatId, "Unknown command. Try /treasury, /brief, /simulate spend &lt;amount&gt; &lt;label&gt;, /plan &lt;objective&gt;, or just ask a question in plain English.");
    } else {
      await handleQuestion(service, chatId, text);
    }
  } catch {
    // A single malformed update must never take the webhook down — Telegram
    // will just move on to the next message.
  }

  return NextResponse.json({ ok: true });
}
