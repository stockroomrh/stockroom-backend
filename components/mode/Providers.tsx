"use client";

import { Suspense, useState } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/lib/wagmi-config";
import { ModeProvider } from "./ModeProvider";
import { AuthProvider } from "./AuthProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <Suspense fallback={null}>
          <ModeProvider>
            <AuthProvider>{children}</AuthProvider>
          </ModeProvider>
        </Suspense>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
