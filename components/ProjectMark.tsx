import type { Project } from "@/lib/types";

export function ProjectMark({ project, size = "medium" }: { project: Pick<Project, "name" | "logoText" | "accent" | "logoUrl">; size?: "small" | "medium" | "large" }) {
  if (project.logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={project.logoUrl} alt={`${project.name} logo`} className={`project-mark project-mark-image ${size}`} />;
  }
  return <span className={`project-mark ${size}`} style={{ background: project.accent }} aria-label={`${project.name} logo`}>{project.logoText}</span>;
}
