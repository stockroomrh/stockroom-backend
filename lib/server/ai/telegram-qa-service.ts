import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { TELEGRAM_QA_SYSTEM_PROMPT, buildTelegramQaUserContent, type TelegramQaPromptInput } from "./telegram-qa-prompt";
import { isAnthropicConfigured } from "./cfo-service";

const MODEL = "claude-opus-5";

/**
 * Answers one free-text treasury question. Plain conversational text, not a
 * structured schema — this is a chat reply, not a report or a recommendation,
 * and it never writes anything to the database itself.
 */
export async function answerTelegramQuestion(input: TelegramQaPromptInput): Promise<string> {
  if (!isAnthropicConfigured()) {
    return "The AI Agent isn't configured yet, so I can't answer questions right now — try /treasury for the current numbers instead.";
  }

  const client = new Anthropic();
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      thinking: { type: "adaptive" },
      system: TELEGRAM_QA_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildTelegramQaUserContent(input) }],
    });
    const textBlock = message.content.find((block) => block.type === "text");
    if (message.stop_reason === "refusal" || !textBlock) return "I wasn't able to generate an answer to that — try rephrasing, or use /treasury for the raw numbers.";
    return textBlock.text.trim();
  } catch {
    return "Something went wrong answering that question — try again in a moment.";
  }
}
