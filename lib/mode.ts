export type AppMode = "preview" | "live";

const MODE_KEY = "stockroom:mode:v1";
const MODE_EVENT = "stockroom-mode-updated";

export function getMode(): AppMode {
  if (typeof window === "undefined") return "preview";
  const stored = window.localStorage.getItem(MODE_KEY);
  return stored === "live" ? "live" : "preview";
}

export function setMode(mode: AppMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MODE_KEY, mode);
  window.dispatchEvent(new Event(MODE_EVENT));
}

export function subscribeMode(callback: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => callback();
  window.addEventListener(MODE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(MODE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export function isLiveModeEnabled() {
  return process.env.NEXT_PUBLIC_ENABLE_LIVE_MODE === "true";
}

export function flagshipProjectSlug() {
  return process.env.NEXT_PUBLIC_FLAGSHIP_PROJECT_SLUG || "stockroom";
}
