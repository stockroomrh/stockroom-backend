import { Panel } from "@/components/UI";
import { useMode } from "@/components/mode/ModeProvider";

export function LoadingState({ label = "Loading treasury data" }: { label?: string }) {
  const { mode } = useMode();
  return <Panel className="state-panel"><div className="loading-orb"/><strong>{label}</strong><span>{mode === "live" ? "Reading live treasury data." : "Reading the mocked service layer."}</span></Panel>;
}

export function ErrorState({ message }: { message: string }) {
  return <Panel className="state-panel error-state"><strong>Something did not load</strong><span>{message}</span></Panel>;
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return <Panel className="state-panel"><strong>{title}</strong><span>{body}</span></Panel>;
}

export function ProjectNotFound({ slug }: { slug: string }) {
  return <Panel className="state-panel"><strong>Project not found</strong><span>No Stockroom project exists at “{slug}”.</span><a className="primary-button" href="/app/explore">Explore projects</a></Panel>;
}
