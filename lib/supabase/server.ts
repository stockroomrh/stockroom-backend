import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export function isSupabaseConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * Session-scoped client for use inside Server Components / Route Handlers.
 * Runs as the calling user (anon or authenticated) — RLS applies. Returns null
 * when Supabase hasn't been provisioned yet — callers (see requireUser) should
 * translate that into a clean "not configured" error rather than crashing.
 */
export async function getSupabaseServerClient() {
  if (!isSupabaseConfigured()) return null;
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
          } catch {
            // Called from a Server Component render — middleware handles the actual refresh.
          }
        },
      },
    },
  );
}

/**
 * Service-role client. NEVER import this file (or SUPABASE_SERVICE_ROLE_KEY) from
 * any file that can be bundled into client code. Bypasses RLS — use only for
 * operations that have already been authorized in application code (e.g. writing
 * audit logs, server-verified chain reads). Returns null when not configured.
 */
export function getSupabaseServiceClient() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const { createClient } = require("@supabase/supabase-js") as typeof import("@supabase/supabase-js");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
