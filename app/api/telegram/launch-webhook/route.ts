import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { sendTelegramMessage, editTelegramMessage, answerCallbackQuery, escapeHtml, type InlineKeyboardMarkup, type InlineKeyboardButton } from "@/lib/server/telegram/bot-client";
import {
  getActiveDraft,
  createDraft,
  updateDraft,
  abandonActiveDraft,
  markAwaitingSignature,
  nextStep,
  previousStep,
  type LaunchStep,
  type LaunchDraftData,
  type LaunchDraftRow,
} from "@/lib/server/telegram/launch-draft";
import { TREASURY_ASSET_CATALOG } from "@/lib/asset-catalog";

// This is a genuinely separate Telegram bot from the operator alerts bot —
// its own token, its own webhook, its own secret. Launching a project is a
// fundamentally different trust boundary (nobody is authenticated yet) from
// operating one that already exists.
export const maxDuration = 30;

type Service = NonNullable<ReturnType<typeof getSupabaseServiceClient>>;

const LAUNCH_BOT_TOKEN = process.env.TELEGRAM_LAUNCH_BOT_TOKEN;

type TelegramUpdate = {
  message?: { chat: { id: number; type: string }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number }; message_id: number } };
};

const WELCOME_TEXT = `🏦 <b>Launch a project on Stockroom</b>\n\nI'll walk you through setting up a token, treasury, and policy — same real backend the web launch wizard uses. Nothing deploys until the very end, when you connect and sign with your own wallet.\n\nSend /cancel any time to discard the draft, /status to see where you are.`;

// --- Step configuration ------------------------------------------------------

type TextStepConfig = {
  kind: "text";
  prompt: string;
  field: keyof LaunchDraftData;
  parse: (input: string) => { ok: true; value: string | number } | { ok: false; error: string };
};

type ChoiceStepConfig = {
  kind: "choice";
  prompt: string;
  field: keyof LaunchDraftData;
  choices: { label: string; value: string | number }[];
};

type StepConfig = TextStepConfig | ChoiceStepConfig;

const STEP_CONFIG: Partial<Record<LaunchStep, StepConfig>> = {
  project_name: {
    kind: "text",
    prompt: "Let's launch a project. What's it called?",
    field: "projectName",
    parse: (input) => {
      const value = input.trim();
      if (value.length < 2 || value.length > 60) return { ok: false, error: "Give it a name between 2 and 60 characters." };
      return { ok: true, value };
    },
  },
  project_symbol: {
    kind: "text",
    prompt: "Ticker symbol? Max 8 characters, e.g. MRDN.",
    field: "projectSymbol",
    parse: (input) => {
      const value = input.trim().toUpperCase();
      if (!/^[A-Z0-9]{1,8}$/.test(value)) return { ok: false, error: "Use 1-8 letters/numbers, no spaces or symbols." };
      return { ok: true, value };
    },
  },
  description: {
    kind: "text",
    prompt: "One or two sentences — what is this project, and what will its public treasury support?",
    field: "description",
    parse: (input) => {
      const value = input.trim();
      if (value.length < 5 || value.length > 500) return { ok: false, error: "Keep it between 5 and 500 characters." };
      return { ok: true, value };
    },
  },
  token_supply: {
    kind: "text",
    prompt: "Total token supply? e.g. 1000000000 for 1 billion.",
    field: "tokenSupply",
    parse: (input) => {
      const value = Number(input.replace(/,/g, "").trim());
      if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) return { ok: false, error: "Enter a positive whole number." };
      return { ok: true, value };
    },
  },
  treasury_address: {
    kind: "text",
    prompt: "Treasury wallet address — an existing wallet or multisig you already control. Stockroom never generates or holds this key. Paste the 0x address.",
    field: "treasuryAddress",
    parse: (input) => {
      const value = input.trim();
      if (!/^0x[a-fA-F0-9]{40}$/.test(value)) return { ok: false, error: "That doesn't look like a valid 0x address." };
      return { ok: true, value };
    },
  },
  reserve_target: {
    kind: "choice",
    prompt: "Minimum USDG reserve target — the policy engine blocks trades that would push it below this?",
    field: "minimumReserve",
    choices: [{ label: "40%", value: 40 }, { label: "50%", value: 50 }, { label: "60%", value: 60 }, { label: "70%", value: 70 }, { label: "80%", value: 80 }],
  },
  revenue_routing: {
    kind: "choice",
    prompt: "How should trading fee revenue route?",
    field: "revenueRouting",
    choices: [
      { label: "100% to treasury", value: "100% to treasury" },
      { label: "80% treasury / 20% ops", value: "80% treasury / 20% operations" },
      { label: "Custom split", value: "__custom__" },
    ],
  },
  max_single_asset: {
    kind: "choice",
    prompt: "Maximum allocation to any single non-reserve asset?",
    field: "maximumSingleAsset",
    choices: [{ label: "10%", value: 10 }, { label: "20%", value: 20 }, { label: "30%", value: 30 }, { label: "40%", value: 40 }],
  },
  max_crypto: {
    kind: "choice",
    prompt: "Maximum total crypto exposure?",
    field: "maximumCrypto",
    choices: [{ label: "10%", value: 10 }, { label: "15%", value: 15 }, { label: "25%", value: 25 }, { label: "40%", value: 40 }],
  },
  max_trade: {
    kind: "choice",
    prompt: "Maximum single trade size, as a % of NAV?",
    field: "maximumTrade",
    choices: [{ label: "5%", value: 5 }, { label: "10%", value: 10 }, { label: "15%", value: 15 }, { label: "25%", value: 25 }],
  },
  risk_approach: {
    kind: "choice",
    prompt: "Treasury Agent's risk approach?",
    field: "riskApproach",
    choices: [{ label: "Conservative", value: "Conservative" }, { label: "Balanced", value: "Balanced" }, { label: "Growth", value: "Growth" }],
  },
  reporting_frequency: {
    kind: "choice",
    prompt: "How often should the Agent report?",
    field: "reportingFrequency",
    choices: [{ label: "Daily", value: "Daily" }, { label: "Weekly", value: "Weekly" }, { label: "Monthly", value: "Monthly" }],
  },
};

// --- Rendering ---------------------------------------------------------------

function choiceKeyboard(step: LaunchStep, choices: { label: string; value: string | number }[]): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [];
  for (let i = 0; i < choices.length; i += 2) {
    rows.push(choices.slice(i, i + 2).map((choice) => ({ text: choice.label, callback_data: `choice:${step}:${choice.value}` })));
  }
  rows.push([{ text: "◀️ Back", callback_data: "nav:back" }]);
  return { inline_keyboard: rows };
}

function assetsKeyboard(selected: string[]): InlineKeyboardMarkup {
  const options = TREASURY_ASSET_CATALOG.filter((asset) => asset.symbol !== "USDG");
  const rows: InlineKeyboardButton[][] = [];
  for (let i = 0; i < options.length; i += 2) {
    rows.push(options.slice(i, i + 2).map((asset) => ({ text: `${selected.includes(asset.symbol) ? "✅ " : ""}${asset.symbol}`, callback_data: `asset:${asset.symbol}` })));
  }
  rows.push([{ text: `Done (${selected.length} selected)`, callback_data: "asset:done" }]);
  rows.push([{ text: "◀️ Back", callback_data: "nav:back" }]);
  return { inline_keyboard: rows };
}

function formatReview(data: LaunchDraftData): string {
  const assets = (data.approvedAssets ?? []).join(", ") || "None beyond the USDG reserve";
  return [
    `<b>Review your launch</b>`,
    ``,
    `Project: <b>${escapeHtml(data.projectName ?? "")}</b> ($${escapeHtml(data.projectSymbol ?? "")})`,
    escapeHtml(data.description ?? ""),
    ``,
    `Token supply: ${(data.tokenSupply ?? 0).toLocaleString()}`,
    `Treasury wallet: <code>${escapeHtml(data.treasuryAddress ?? "")}</code>`,
    ``,
    `Minimum reserve: ${data.minimumReserve}%`,
    `Approved assets: ${escapeHtml(assets)}`,
    `Revenue routing: ${escapeHtml(data.revenueRouting ?? "")}`,
    `Max single asset: ${data.maximumSingleAsset}% · Max crypto: ${data.maximumCrypto}% · Max trade: ${data.maximumTrade}%`,
    ``,
    `Treasury Agent: ${escapeHtml(data.riskApproach ?? "")} · ${escapeHtml(data.reportingFrequency ?? "")} reports`,
    ``,
    `Nothing deploys yet. Confirm below, then connect and sign with the wallet that will control the treasury.`,
  ].join("\n");
}

function reviewKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "✅ Continue to sign", callback_data: "review:confirm" }],
      [{ text: "◀️ Back", callback_data: "nav:back" }, { text: "🔄 Start over", callback_data: "review:restart" }],
    ],
  };
}

function renderStep(step: LaunchStep, data: LaunchDraftData): { text: string; keyboard?: InlineKeyboardMarkup } {
  if (step === "approved_assets") {
    return { text: "Which assets, beyond the USDG reserve, can the Treasury Agent hold and recommend? Tap to toggle.", keyboard: assetsKeyboard(data.approvedAssets ?? []) };
  }
  if (step === "revenue_routing_custom") {
    return { text: "Describe the custom revenue split in a short sentence." };
  }
  if (step === "review") {
    return { text: formatReview(data), keyboard: reviewKeyboard() };
  }
  const config = STEP_CONFIG[step];
  if (!config) return { text: "..." };
  if (config.kind === "text") return { text: config.prompt };
  return { text: config.prompt, keyboard: choiceKeyboard(step, config.choices) };
}

// --- Text replies --------------------------------------------------------

async function handleTextReply(service: Service, draft: LaunchDraftRow, chatId: string, text: string) {
  if (draft.step === "revenue_routing_custom") {
    const value = text.trim();
    if (value.length < 3 || value.length > 200) {
      await sendTelegramMessage(chatId, "⚠️ Keep it between 3 and 200 characters.", undefined, LAUNCH_BOT_TOKEN);
      return;
    }
    const newData: LaunchDraftData = { ...draft.data, revenueRouting: value };
    const next = nextStep("revenue_routing_custom");
    await updateDraft(service, draft.id, { step: next, data: newData });
    const rendered = renderStep(next, newData);
    await sendTelegramMessage(chatId, rendered.text, rendered.keyboard, LAUNCH_BOT_TOKEN);
    return;
  }

  const config = STEP_CONFIG[draft.step];
  if (!config || config.kind !== "text") {
    await sendTelegramMessage(chatId, "Please use the buttons above to answer this step — or /status to see it again.", undefined, LAUNCH_BOT_TOKEN);
    return;
  }
  const parsed = config.parse(text);
  if (!parsed.ok) {
    await sendTelegramMessage(chatId, `⚠️ ${parsed.error}`, undefined, LAUNCH_BOT_TOKEN);
    return;
  }
  const newData = { ...draft.data, [config.field]: parsed.value } as unknown as LaunchDraftData;
  const next = nextStep(draft.step);
  await updateDraft(service, draft.id, { step: next, data: newData });
  const rendered = renderStep(next, newData);
  await sendTelegramMessage(chatId, rendered.text, rendered.keyboard, LAUNCH_BOT_TOKEN);
}

// --- Button taps -----------------------------------------------------------

async function handleCallback(service: Service, callback: NonNullable<TelegramUpdate["callback_query"]>) {
  const chatId = callback.message ? String(callback.message.chat.id) : null;
  const messageId = callback.message?.message_id;
  const data = callback.data ?? "";
  if (!chatId || !messageId) {
    await answerCallbackQuery(callback.id, undefined, LAUNCH_BOT_TOKEN);
    return;
  }

  const draft = await getActiveDraft(service, chatId);
  if (!draft) {
    await answerCallbackQuery(callback.id, "This draft is no longer active — send /launch to start.", LAUNCH_BOT_TOKEN);
    return;
  }

  try {
    if (data === "nav:back") {
      const prev = previousStep(draft.step);
      await updateDraft(service, draft.id, { step: prev });
      await answerCallbackQuery(callback.id, undefined, LAUNCH_BOT_TOKEN);
      const rendered = renderStep(prev, draft.data);
      await editTelegramMessage(chatId, messageId, rendered.text, rendered.keyboard, LAUNCH_BOT_TOKEN);
      return;
    }

    if (data.startsWith("asset:")) {
      if (draft.step !== "approved_assets") {
        await answerCallbackQuery(callback.id, "This step has moved on.", LAUNCH_BOT_TOKEN);
        return;
      }
      const symbol = data.slice("asset:".length);
      if (symbol === "done") {
        const next = nextStep("approved_assets");
        await updateDraft(service, draft.id, { step: next });
        await answerCallbackQuery(callback.id, undefined, LAUNCH_BOT_TOKEN);
        const rendered = renderStep(next, draft.data);
        await editTelegramMessage(chatId, messageId, rendered.text, rendered.keyboard, LAUNCH_BOT_TOKEN);
        return;
      }
      const current = draft.data.approvedAssets ?? [];
      const updated = current.includes(symbol) ? current.filter((existing) => existing !== symbol) : [...current, symbol];
      const newData: LaunchDraftData = { ...draft.data, approvedAssets: updated };
      await updateDraft(service, draft.id, { data: newData });
      await answerCallbackQuery(callback.id, undefined, LAUNCH_BOT_TOKEN);
      await editTelegramMessage(chatId, messageId, renderStep("approved_assets", newData).text, assetsKeyboard(updated), LAUNCH_BOT_TOKEN);
      return;
    }

    if (data.startsWith("choice:")) {
      const [, step, rawValue] = data.split(":");
      if (step !== draft.step) {
        await answerCallbackQuery(callback.id, "This step has moved on.", LAUNCH_BOT_TOKEN);
        return;
      }
      if (step === "revenue_routing" && rawValue === "__custom__") {
        await updateDraft(service, draft.id, { step: "revenue_routing_custom" });
        await answerCallbackQuery(callback.id, undefined, LAUNCH_BOT_TOKEN);
        await editTelegramMessage(chatId, messageId, "Describe the custom revenue split in a short sentence.", undefined, LAUNCH_BOT_TOKEN);
        return;
      }
      const config = STEP_CONFIG[step as LaunchStep];
      if (!config || config.kind !== "choice") {
        await answerCallbackQuery(callback.id, undefined, LAUNCH_BOT_TOKEN);
        return;
      }
      const matched = config.choices.find((choice) => String(choice.value) === rawValue);
      if (!matched) {
        await answerCallbackQuery(callback.id, undefined, LAUNCH_BOT_TOKEN);
        return;
      }
      const newData = { ...draft.data, [config.field]: matched.value } as unknown as LaunchDraftData;
      const next = nextStep(step as LaunchStep);
      await updateDraft(service, draft.id, { step: next, data: newData });
      await answerCallbackQuery(callback.id, undefined, LAUNCH_BOT_TOKEN);
      const rendered = renderStep(next, newData);
      await editTelegramMessage(chatId, messageId, rendered.text, rendered.keyboard, LAUNCH_BOT_TOKEN);
      return;
    }

    if (data === "review:confirm") {
      await markAwaitingSignature(service, draft.id);
      await answerCallbackQuery(callback.id, "Preparing your sign-in link...", LAUNCH_BOT_TOKEN);
      const signUrl = `https://stockroom.finance/app/launch?draft=${draft.draft_token}`;
      const text = [
        "🔐 <b>One step left.</b>",
        "",
        "Open the link below, connect the wallet that will control this treasury, and sign to deploy. Nothing has been created yet — this is where that actually happens.",
        "",
        "This link expires in 30 minutes. If it expires, send /status here for a fresh one.",
      ].join("\n");
      await editTelegramMessage(chatId, messageId, text, { inline_keyboard: [[{ text: "🔐 Connect wallet & sign", url: signUrl }]] }, LAUNCH_BOT_TOKEN);
      return;
    }

    if (data === "review:restart") {
      await abandonActiveDraft(service, chatId);
      await answerCallbackQuery(callback.id, undefined, LAUNCH_BOT_TOKEN);
      await editTelegramMessage(chatId, messageId, "Draft discarded. Send /launch to start a new one.", undefined, LAUNCH_BOT_TOKEN);
      return;
    }

    await answerCallbackQuery(callback.id, undefined, LAUNCH_BOT_TOKEN);
  } catch {
    await answerCallbackQuery(callback.id, "Something went wrong.", LAUNCH_BOT_TOKEN);
  }
}

// --- Entry point ---------------------------------------------------------

export async function POST(request: Request) {
  const expectedSecret = process.env.TELEGRAM_LAUNCH_WEBHOOK_SECRET;
  if (!expectedSecret) return NextResponse.json({ error: "Telegram launch bot is not configured." }, { status: 503 });
  if (request.headers.get("x-telegram-bot-api-secret-token") !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const service = getSupabaseServiceClient();
  if (!service) return NextResponse.json({ ok: true });

  const update = (await request.json().catch(() => null)) as TelegramUpdate | null;

  if (update?.callback_query) {
    try {
      await handleCallback(service, update.callback_query);
    } catch {
      // A single malformed callback must never take the webhook down.
    }
    return NextResponse.json({ ok: true });
  }

  const message = update?.message;
  if (!message?.text) return NextResponse.json({ ok: true });

  const chatId = String(message.chat.id);
  const text = message.text.trim();

  try {
    if (text === "/launch" || text === "/start") {
      let draft = await getActiveDraft(service, chatId);
      const isNew = !draft;
      if (!draft) draft = await createDraft(service, chatId);
      const rendered = renderStep(draft.step, draft.data);
      await sendTelegramMessage(chatId, isNew ? `${WELCOME_TEXT}\n\n${rendered.text}` : rendered.text, rendered.keyboard, LAUNCH_BOT_TOKEN);
    } else if (text === "/cancel") {
      await abandonActiveDraft(service, chatId);
      await sendTelegramMessage(chatId, "Draft discarded. Send /launch whenever you're ready to start.", undefined, LAUNCH_BOT_TOKEN);
    } else if (text === "/status") {
      const draft = await getActiveDraft(service, chatId);
      if (!draft) {
        await sendTelegramMessage(chatId, "No draft in progress. Send /launch to start one.", undefined, LAUNCH_BOT_TOKEN);
      } else if (draft.status === "awaiting_signature") {
        await markAwaitingSignature(service, draft.id);
        const signUrl = `https://stockroom.finance/app/launch?draft=${draft.draft_token}`;
        await sendTelegramMessage(chatId, "🔐 Here's a fresh sign-in link — it expires in 30 minutes.", { inline_keyboard: [[{ text: "🔐 Connect wallet & sign", url: signUrl }]] }, LAUNCH_BOT_TOKEN);
      } else {
        const rendered = renderStep(draft.step, draft.data);
        await sendTelegramMessage(chatId, rendered.text, rendered.keyboard, LAUNCH_BOT_TOKEN);
      }
    } else {
      const draft = await getActiveDraft(service, chatId);
      if (!draft) {
        await sendTelegramMessage(chatId, "Send /launch to start building a new Stockroom project.", undefined, LAUNCH_BOT_TOKEN);
      } else {
        await handleTextReply(service, draft, chatId, text);
      }
    }
  } catch {
    // A single malformed update must never take the webhook down.
  }

  return NextResponse.json({ ok: true });
}
