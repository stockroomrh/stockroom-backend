"use client";

import { PageTitle } from "@/components/PageTitle";
import { StatusBadge } from "@/components/UI";
import { OperatorConsole } from "@/components/OperatorConsole";
import { useMode } from "@/components/mode/ModeProvider";

export function OperatorView({ slug }: { slug: string }) {
  const { mode } = useMode();
  return <><PageTitle eyebrow="Private human-approval workspace" title="OPERATOR CONSOLE" subtitle="Review policy-bound proposals before any wallet can sign." action={<StatusBadge tone="green">{mode === "live" ? "Live protected" : "Mock protected"}</StatusBadge>}/><OperatorConsole slug={slug}/></>;
}
