import "server-only";

export function isTelegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

export type InlineKeyboardButton = { text: string; callback_data: string } | { text: string; url: string } | { text: string; web_app: { url: string } };
export type InlineKeyboardMarkup = { inline_keyboard: InlineKeyboardButton[][] };
export type ReplyKeyboardMarkup = { keyboard: { text: string }[][]; resize_keyboard: true; is_persistent: true };
export type TelegramReplyMarkup = InlineKeyboardMarkup | ReplyKeyboardMarkup;

/**
 * Sends one message to a Telegram chat via the Bot API. Real HTTP call, no
 * queueing/retry — a failed alert is logged by the caller and skipped, never
 * silently fabricated as "sent". Returns the sent message_id so callers can
 * later edit it in place (e.g. turning a "generating..." placeholder into
 * the finished result) rather than spamming a new message per step.
 *
 * `botToken` defaults to the operator bot (TELEGRAM_BOT_TOKEN) — pass the
 * launch bot's token explicitly to send from that bot instead. Two separate
 * bots, one shared low-level HTTP client.
 */
export async function sendTelegramMessage(chatId: string, text: string, replyMarkup?: TelegramReplyMarkup, botToken?: string): Promise<{ ok: boolean; error?: string; messageId?: number }> {
  const token = botToken ?? process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, error: "Telegram bot token is not configured." };

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: replyMarkup }),
    });
    const body = (await response.json()) as { ok: boolean; description?: string; result?: { message_id: number } };
    if (!response.ok || !body.ok) return { ok: false, error: body.description ?? `Telegram API returned ${response.status}` };
    return { ok: true, messageId: body.result?.message_id };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : "Failed to reach Telegram." };
  }
}

/**
 * Edits an already-sent message in place. Used to turn a "generating..."
 * placeholder into the finished AI result, and for the treasury refresh
 * button — keeps the chat clean instead of a new message per interaction.
 * A no-op edit (identical text) is a normal Telegram 400 ("message is not
 * modified"), not a real failure, so callers don't need to guard against it.
 */
export async function editTelegramMessage(chatId: string, messageId: number, text: string, replyMarkup?: InlineKeyboardMarkup, botToken?: string): Promise<{ ok: boolean; error?: string }> {
  const token = botToken ?? process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, error: "Telegram bot token is not configured." };

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: replyMarkup }),
    });
    const body = (await response.json()) as { ok: boolean; description?: string };
    if (!response.ok || !body.ok) return { ok: false, error: body.description ?? `Telegram API returned ${response.status}` };
    return { ok: true };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : "Failed to reach Telegram." };
  }
}

/**
 * Clears the loading spinner on a tapped inline button. Telegram requires
 * this on every callback_query or the button stays in a spinning state
 * client-side until it times out on its own.
 */
export async function answerCallbackQuery(callbackQueryId: string, text?: string, botToken?: string): Promise<void> {
  const token = botToken ?? process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: false }),
    });
  } catch {
    // Non-fatal — worst case the button spinner clears itself after Telegram's own timeout.
  }
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
