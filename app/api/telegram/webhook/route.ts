import { NextResponse, after } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { getProjectPolicy, getTreasuryData } from "@/lib/server/db/queries";
import { generateAndStoreAgentReport, getRecommendationsForProject } from "@/lib/server/db/agent-reports";
import { generateAndStorePlan } from "@/lib/server/db/treasury-plans";
import { answerTelegramQuestion } from "@/lib/server/ai/telegram-qa-service";
import { simulateSpend } from "@/lib/server/telegram/simulate-spend";
import { sendTelegramMessage, escapeHtml } from "@/lib/server/telegram/bot-client";

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
};

type LinkedProject = { projectId: string; projectSlug: string; projectName: string; actorProfileId: string | null };

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
    `✅ This chat is now linked to <b>${escapeHtml(project.name)}</b>. You'll get alerts here for real deposits and withdrawals.\n\nTry:\n/treasury — current status\n/brief — AI daily summary\n/simulate spend 2000 marketing — test a hypothetical expense\nOr just ask a question in plain English, e.g. "how healthy is the treasury?"`,
  );
}

function healthExplanation(health: string, reserve: number, target: number): string {
  if (health === "AT RISK") return `Reserve is ${Math.max(0, target - reserve).toFixed(0)}pp below the ${target}% target — the policy engine will block most new buys until this improves.`;
  if (health === "WATCH") return `Reserve is close to the ${target}% target but not there yet — worth monitoring.`;
  return `Reserve is at or above the ${target}% target.`;
}

async function handleTreasuryCommand(service: Service, chatId: string) {
  const linked = await getLinkedProject(service, chatId);
  if (!linked) return sendTelegramMessage(chatId, NOT_LINKED_MESSAGE);

  const policy = await getProjectPolicy(service, linked.projectId);
  if (!policy) return sendTelegramMessage(chatId, "This project has no treasury policy configured yet.");
  const { summary, activity } = await getTreasuryData(service, linked.projectId, policy);

  if (!summary) return sendTelegramMessage(chatId, `<b>${escapeHtml(linked.projectName)}</b> Treasury\nNo treasury snapshot indexed yet.`);

  const recent = activity
    .filter((item) => item.type === "Deposit" || item.type === "Withdrawal")
    .slice(0, 5)
    .map((item) => `${item.type === "Deposit" ? "↓ Deposited" : "↑ Withdrew"} ${item.amount} ${item.asset} · ${item.usdValue}`)
    .join("\n");

  const baseUrl = `https://stockroom.finance/app/project/${linked.projectSlug}`;
  const text = [
    `<b>${escapeHtml(linked.projectName)} Treasury</b>`,
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

async function handleBriefCommand(service: Service, chatId: string) {
  const linked = await getLinkedProject(service, chatId);
  if (!linked) return sendTelegramMessage(chatId, NOT_LINKED_MESSAGE);
  if (!linked.actorProfileId) return sendTelegramMessage(chatId, "This chat was linked before /brief existed — re-link it from the Operator Console to enable AI commands.");

  await sendTelegramMessage(chatId, "🧠 Generating your treasury brief — this takes about a minute...");

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
      await sendTelegramMessage(chatId, text);
    } catch (cause) {
      await sendTelegramMessage(chatId, `Couldn't generate a brief right now: ${cause instanceof Error ? cause.message : "unknown error"}`);
    }
  });
}

async function handleSimulateCommand(service: Service, chatId: string, rest: string) {
  const linked = await getLinkedProject(service, chatId);
  if (!linked) return sendTelegramMessage(chatId, NOT_LINKED_MESSAGE);

  const match = rest.match(/^spend\s+\$?([\d,]+(?:\.\d+)?)\s+(?:on\s+)?(.+)$/i);
  if (!match) return sendTelegramMessage(chatId, "Usage: /simulate spend 2000 marketing");
  const amountUsd = Number(match[1].replace(/,/g, ""));
  const label = match[2].trim();
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return sendTelegramMessage(chatId, "That doesn't look like a valid amount.");

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
  const fmt = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  const lines = [
    `<b>${escapeHtml(label)} spend simulation</b>`,
    ``,
    `Treasury before: ${fmt(sim.before.valueUsd)}`,
    `Treasury after: ${fmt(sim.after.valueUsd)}`,
    `Reserve ratio: ${sim.before.reservePct}% → ${sim.after.reservePct}%`,
    ``,
    `Policy result: <b>${sim.blocked ? "Blocked" : "Would pass"}</b>`,
  ];
  if (sim.blocked) {
    lines.push(`Reason: reserve coverage would fall below the ${sim.targetPct}% target.`);
    lines.push(``, `Safer alternative: spend up to ${fmt(sim.maxAffordableUsd)} now while staying at the ${sim.targetPct}% reserve target.`);
  } else {
    lines.push(`This stays at or above the ${sim.targetPct}% reserve target.`);
  }
  lines.push(``, `<i>This is a simulation only — nothing was proposed or executed.</i>`);

  return sendTelegramMessage(chatId, lines.join("\n"));
}

async function handlePlanCommand(service: Service, chatId: string, objective: string) {
  const linked = await getLinkedProject(service, chatId);
  if (!linked) return sendTelegramMessage(chatId, NOT_LINKED_MESSAGE);
  if (!linked.actorProfileId) return sendTelegramMessage(chatId, "This chat was linked before /plan existed — re-link it from the Operator Console to enable AI commands.");
  if (!objective.trim()) return sendTelegramMessage(chatId, 'Usage: /plan build a $10,000 marketing reserve over the next month');

  await sendTelegramMessage(chatId, "🧠 Building a staged plan for that — this takes about a minute...");

  after(async () => {
    try {
      const plan = await generateAndStorePlan(service, linked.projectId, linked.projectSlug, linked.actorProfileId as string, objective.trim());
      const steps = plan.steps.slice(0, 6).map((step, i) => `${i + 1}. ${step.recommendation.title} — ${step.condition}`).join("\n");
      const text = [
        `<b>Staged plan created</b>`,
        `Objective: ${escapeHtml(objective.trim())}`,
        ``,
        steps || "No steps were proposed — the treasury may already satisfy this objective, or nothing approved fits it.",
        ``,
        `Nothing executes automatically — review and approve each step from the Operator Console.`,
        `<a href="https://stockroom.finance/app/dashboard/projects/${linked.projectSlug}/operator">Open in Stockroom ↗</a>`,
      ].join("\n");
      await sendTelegramMessage(chatId, text);
    } catch (cause) {
      await sendTelegramMessage(chatId, `Couldn't build that plan right now: ${cause instanceof Error ? cause.message : "unknown error"}`);
    }
  });
}

async function handleQuestion(service: Service, chatId: string, question: string) {
  const linked = await getLinkedProject(service, chatId);
  if (!linked) return sendTelegramMessage(chatId, NOT_LINKED_MESSAGE);

  const policy = await getProjectPolicy(service, linked.projectId);
  if (!policy) return sendTelegramMessage(chatId, "This project has no treasury policy configured yet.");

  after(async () => {
    try {
      const { summary, positions, activity } = await getTreasuryData(service, linked.projectId, policy);
      const openRecommendations = await getRecommendationsForProject(service, linked.projectId, linked.projectSlug, policy.humanApproval);

      const answer = await answerTelegramQuestion({ projectName: linked.projectName, question, summary, positions, activity, policy, openRecommendations });
      await sendTelegramMessage(chatId, escapeHtml(answer));
    } catch (cause) {
      await sendTelegramMessage(chatId, `Couldn't answer that right now: ${cause instanceof Error ? cause.message : "unknown error"}`);
    }
  });
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
    } else if (text === "/start") {
      await sendTelegramMessage(chatId, "Link this chat to a project from its Operator Console — it'll give you a code to paste here as /start &lt;code&gt;.");
    } else if (text === "/treasury") {
      await handleTreasuryCommand(service, chatId);
    } else if (text === "/brief") {
      await handleBriefCommand(service, chatId);
    } else if (text.startsWith("/simulate ")) {
      await handleSimulateCommand(service, chatId, text.slice("/simulate ".length).trim());
    } else if (text.startsWith("/plan ")) {
      await handlePlanCommand(service, chatId, text.slice("/plan ".length).trim());
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
