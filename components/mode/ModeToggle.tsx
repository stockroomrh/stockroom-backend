"use client";

import { useMode } from "./ModeProvider";

export function ModeToggle() {
  const { mode, liveModeEnabled, setMode } = useMode();
  if (!liveModeEnabled) {
    return <span className="mode-toggle mode-toggle-disabled" title="Live mode is not enabled yet">PREVIEW</span>;
  }
  return (
    <div className="mode-toggle" role="group" aria-label="Preview or Live mode">
      <button type="button" className={mode === "preview" ? "active" : ""} onClick={() => setMode("preview")}>Preview</button>
      <button type="button" className={mode === "live" ? "active" : ""} onClick={() => setMode("live")}>Live</button>
    </div>
  );
}
