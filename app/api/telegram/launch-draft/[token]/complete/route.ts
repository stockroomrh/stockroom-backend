import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { getDraftByToken, markDraftCompleted } from "@/lib/server/telegram/launch-draft";
import { sendTelegramMessage, escapeHtml } from "@/lib/server/telegram/bot-client";

const LAUNCH_BOT_TOKEN = process.env.TELEGRAM_LAUNCH_BOT_TOKEN;

// Called by the web launch wizard right after a Telegram-drafted project's
// deploy tx is recorded — closes the loop by telling the chat it's live.
// The draft_token itself (128 bits, single-use — this 404s once the draft
// isn't "awaiting_signature" anymore) is the only credential here; there's
// no authenticated user yet at this point in the flow.
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const service = getSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "Live mode is not configured yet." }, { status: 503 });

  const draft = await getDraftByToken(service, token);
  if (!draft || draft.status !== "awaiting_signature") return NextResponse.json({ error: "Invalid or already-completed draft." }, { status: 404 });

  const body = await request.json().catch(() => null);
  const slug = typeof body?.slug === "string" ? body.slug : null;
  if (!slug) return NextResponse.json({ error: "Missing project slug." }, { status: 400 });

  await markDraftCompleted(service, draft.id);

  if (LAUNCH_BOT_TOKEN) {
    const projectName = draft.data.projectName ?? "Your project";
    const text = [
      `🎉 <b>${escapeHtml(projectName)} is live.</b>`,
      ``,
      `The token deployed and the project is published.`,
      ``,
      `<a href="https://stockroom.finance/app/project/${slug}">View public project ↗</a>`,
      `<a href="https://stockroom.finance/app/dashboard/projects/${slug}/operator">Open Operator Console ↗</a>`,
    ].join("\n");
    await sendTelegramMessage(draft.chat_id, text, undefined, LAUNCH_BOT_TOKEN);
  }

  return NextResponse.json({ ok: true });
}
