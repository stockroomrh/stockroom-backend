import { LaunchWizard } from "@/components/LaunchWizard";
import { Providers } from "@/components/mode/Providers";
import { TelegramWebAppInit } from "@/components/TelegramWebAppInit";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { getDraftByToken, draftToLaunchInput } from "@/lib/server/telegram/launch-draft";

// Deliberately outside app/app/ — no topbar, no nav, no marketing chrome.
// Reached only via the Telegram launch bot's Mini App button: a bare
// confirm-and-sign screen so the handoff feels like part of the bot, not a
// trip to the website. Telegram's own Mini App header still shows the
// domain (a platform-level thing no developer can turn off) — this is the
// most that's achievable on top of that.
export default async function LaunchSignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const service = getSupabaseServiceClient();
  const draft = service ? await getDraftByToken(service, token) : null;

  const invalid = !draft || draft.status !== "awaiting_signature";
  const expired = draft?.expires_at ? new Date(draft.expires_at).getTime() < Date.now() : false;

  if (invalid || expired) {
    return (
      <div className="launch-sign-solo">
        <div className="form-error">
          {expired
            ? "This link has expired. Go back to Telegram and send /status for a fresh one."
            : "This link has already been used or is no longer valid. Go back to Telegram and send /status for a fresh one."}
        </div>
      </div>
    );
  }

  const input = draftToLaunchInput(draft.data);

  return (
    <Providers>
      <TelegramWebAppInit />
      <LaunchWizard draftPrefill={{ token: draft.draft_token, input }} minimal />
    </Providers>
  );
}
