import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { AuthError } from "@/lib/server/auth/session";
import { requireProjectRole } from "@/lib/server/auth/roles";
import { checkRateLimit, RateLimitError } from "@/lib/server/rate-limit";

const CODE_TTL_MINUTES = 15;

function generateCode(): string {
  return randomBytes(5).toString("hex"); // 10 hex chars — short enough to type, long enough not to guess
}

// Generates a short-lived code an operator pastes into Telegram as
// `/start <code>` to link that chat to this project. The code is only ever
// shown inside the authenticated console — linking a chat requires real
// project access, not just knowing the bot exists. On top of that, an extra
// shared password gates this specific action, since it's the one thing in
// the console that exposes a project's treasury data to a brand new,
// unauthenticated Telegram chat.
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { projectId, user } = await requireProjectRole(slug, "operator");
    checkRateLimit(`telegram-link-code:${user.id}`, 10, 300);

    const lockPassword = process.env.TELEGRAM_LINK_PASSWORD;
    if (!lockPassword) return NextResponse.json({ error: "Telegram linking is not configured yet." }, { status: 503 });

    const body = await request.json().catch(() => null);
    const submittedPassword = typeof body?.password === "string" ? body.password : "";
    if (submittedPassword !== lockPassword) return NextResponse.json({ error: "Incorrect password." }, { status: 403 });

    const service = getSupabaseServiceClient();
    if (!service) return NextResponse.json({ error: "Live mode is not configured yet." }, { status: 503 });

    const botUsername = process.env.TELEGRAM_BOT_USERNAME;
    if (!botUsername) return NextResponse.json({ error: "Telegram bot is not configured yet." }, { status: 503 });

    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString();

    const { error } = await service.from("telegram_link_codes").insert({ project_id: projectId, code, created_by: user.id, expires_at: expiresAt });
    if (error) throw new Error(error.message);

    return NextResponse.json({ code, expiresAt, deepLink: `https://t.me/${botUsername}?start=${code}`, expiresInMinutes: CODE_TTL_MINUTES });
  } catch (cause) {
    if (cause instanceof AuthError) return NextResponse.json({ error: cause.message }, { status: 403 });
    if (cause instanceof RateLimitError) return NextResponse.json({ error: cause.message }, { status: 429, headers: { "Retry-After": String(cause.retryAfterSeconds) } });
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Failed to generate a link code." }, { status: 500 });
  }
}
