"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useAccount, useConnect, useDisconnect, useSignMessage } from "wagmi";
import { createSiweMessage, generateSiweNonce } from "viem/siwe";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

type WalletOption = { id: string; name: string };

type AuthContextValue = {
  session: Session | null;
  walletAddress: `0x${string}` | undefined;
  connecting: boolean;
  error: string | null;
  supabaseConfigured: boolean;
  walletOptions: WalletOption[];
  signInWithWallet: (connectorId?: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const { address, chainId: activeChainId, connector: activeConnector } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const [session, setSession] = useState<Session | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => setSession(data.session));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event: string, nextSession: Session | null) => setSession(nextSession));
    return () => subscription.subscription.unsubscribe();
  }, [supabase]);

  const walletOptions = useMemo<WalletOption[]>(() => connectors.map((connector) => ({ id: connector.id, name: connector.name })), [connectors]);

  const signInWithWallet = async (connectorId?: string) => {
    setError(null);
    if (!supabase) {
      setError("Live authentication is not configured yet (Supabase is not connected).");
      return;
    }
    setConnecting(true);
    try {
      let account = address;
      let chainId = activeChainId;

      // If a wallet is already connected at the browser/wagmi level (persisted
      // across reloads), don't try to "reconnect" it — that throws or silently
      // no-ops instead of prompting anything. Just use its existing account/chain.
      const alreadyConnected = account && (!connectorId || activeConnector?.id === connectorId);

      if (!alreadyConnected) {
        // wagmi registers a generic "injected" connector alongside a distinct,
        // properly-named connector per EIP-6963 announced wallet. The generic
        // one is often first in the list but doesn't reliably open a real wallet
        // when multiple extensions are installed — so when no specific
        // connector is requested, try each candidate in order and use the
        // first one that actually connects, rather than assuming index 0 works.
        const candidates = connectorId
          ? connectors.filter((item) => item.id === connectorId)
          : [...connectors].sort((a, b) => (a.id === "injected" ? 1 : b.id === "injected" ? -1 : 0));
        if (!candidates.length) throw new Error("No wallet connector available.");

        let lastError: unknown = null;
        let connected: { accounts: readonly `0x${string}`[]; chainId: number } | null = null;
        for (const connector of candidates) {
          try {
            connected = await connectAsync({ connector });
            if (!connected.accounts?.length) throw new Error("Wallet connected but returned no account.");
            break;
          } catch (cause) {
            lastError = cause;
            connected = null;
          }
        }
        if (!connected) throw lastError instanceof Error ? lastError : new Error("Unable to connect to any detected wallet.");
        account = connected.accounts[0];
        chainId = connected.chainId;
      }

      if (!account || !chainId) throw new Error("Wallet is connected but did not report an address/chain.");

      // Build and sign the SIWE message ourselves via viem/wagmi rather than
      // handing an EIP-1193 provider to supabase-js's signInWithWeb3 — that
      // path hex-encodes the message in a way some wallets (e.g. Phantom)
      // reject with "signature request cannot be shown due to invalid
      // formatting". Signing through wagmi's well-tested useSignMessage and
      // passing the resulting {message, signature} pair sidesteps that bug.
      const message = createSiweMessage({
        domain: window.location.host,
        address: account,
        statement: "Sign in to Stockroom to prove ownership of this wallet.",
        uri: window.location.origin,
        version: "1",
        chainId,
        nonce: generateSiweNonce(),
      });
      const signature = await signMessageAsync({ account, message });

      const { error: signInError } = await supabase.auth.signInWithWeb3({
        chain: "ethereum",
        message,
        signature,
      });
      if (signInError) throw signInError;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Wallet sign-in failed.");
    } finally {
      setConnecting(false);
    }
  };

  const signOut = async () => {
    await supabase?.auth.signOut();
    await disconnectAsync().catch(() => undefined);
  };

  const value = useMemo<AuthContextValue>(
    () => ({ session, walletAddress: address, connecting, error, supabaseConfigured: isSupabaseConfigured(), walletOptions, signInWithWallet, signOut }),
    [session, address, connecting, error, walletOptions],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
