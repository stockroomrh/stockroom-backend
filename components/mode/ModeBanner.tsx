"use client";

import { useMode } from "./ModeProvider";

export function ModeBanner() {
  const { mode } = useMode();
  if (mode === "live") {
    return (
      <div className="mode-banner mode-banner-live">
        <span className="live-dot" />
        <strong>LIVE</strong>
        <span>Real Robinhood Chain data. Every trade still requires an authorised wallet signature.</span>
      </div>
    );
  }
  return (
    <div className="mode-banner mode-banner-preview">
      <strong>PREVIEW</strong>
      <span>Demonstration data. Not the real Stockroom treasury.</span>
    </div>
  );
}
