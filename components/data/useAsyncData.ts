"use client";

import { useCallback, useEffect, useState } from "react";
import { subscribeProjectStore } from "@/lib/services";
import { subscribeMode } from "@/lib/mode";

export function useAsyncData<T>(loader: () => Promise<T>, dependencies: readonly unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(loader, dependencies);

  useEffect(() => {
    let active = true;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const value = await load();
        if (active) setData(value);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load data");
      } finally {
        if (active) setLoading(false);
      }
    };
    void run();
    const unsubscribeStore = subscribeProjectStore(() => void run());
    const unsubscribeMode = subscribeMode(() => void run());
    return () => {
      active = false;
      unsubscribeStore();
      unsubscribeMode();
    };
  }, [load]);

  return { data, loading, error, reload: load };
}
