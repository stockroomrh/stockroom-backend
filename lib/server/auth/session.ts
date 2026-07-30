import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export type AuthedUser = {
  id: string;
  walletAddress: string;
};

/**
 * Resolves the caller's identity for a Route Handler. Wallet connection alone
 * is never treated as authentication — this reads the verified Supabase
 * session established via signInWithWeb3's message-signature check.
 */
export async function requireUser(): Promise<AuthedUser> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) throw new AuthError("Live mode is not configured yet (Supabase is not connected).");
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new AuthError("Not authenticated. Connect and sign in with a wallet first.");
  const walletAddress = (data.user.user_metadata?.custom_claims as { address?: string } | undefined)?.address
    ?? (data.user.user_metadata?.address as string | undefined);
  if (!walletAddress) throw new AuthError("Authenticated session has no linked wallet address.");
  return { id: data.user.id, walletAddress };
}

export class AuthError extends Error {}
