"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type AppMode, getMode, isLiveModeEnabled, setMode, subscribeMode } from "@/lib/mode";

type ModeContextValue = {
  mode: AppMode;
  liveModeEnabled: boolean;
  setMode: (mode: AppMode) => void;
};

const ModeContext = createContext<ModeContextValue | null>(null);

export function ModeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setModeState] = useState<AppMode>("preview");
  const liveModeEnabled = isLiveModeEnabled();

  useEffect(() => {
    const fromUrl = searchParams.get("mode");
    if (fromUrl === "live" || fromUrl === "preview") {
      setMode(fromUrl);
      setModeState(fromUrl);
      return;
    }
    setModeState(getMode());
    // Only resolve initial precedence once on mount; subsequent changes flow through subscribeMode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => subscribeMode(() => setModeState(getMode())), []);

  const updateMode = (next: AppMode) => {
    if (next === "live" && !liveModeEnabled) return;
    setMode(next);
    setModeState(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set("mode", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const value = useMemo(() => ({ mode, liveModeEnabled, setMode: updateMode }), [mode, liveModeEnabled, pathname]);

  return <ModeContext.Provider value={value}>{children}</ModeContext.Provider>;
}

export function useMode() {
  const context = useContext(ModeContext);
  if (!context) throw new Error("useMode must be used within a ModeProvider");
  return context;
}
