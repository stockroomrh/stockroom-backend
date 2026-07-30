"use client";

import { usePathname, useRouter } from "next/navigation";
import { getProjects } from "@/lib/services";
import { useAsyncData } from "@/components/data/useAsyncData";

function routeProject(pathname: string) {
  return pathname.match(/^\/app\/project\/([^/]+)/)?.[1]
    ?? pathname.match(/^\/app\/dashboard\/projects\/([^/]+)/)?.[1]
    ?? null;
}

export function ProjectSelector({
  compact = false,
  fallbackSlug = "stockroom",
  onProjectSelected,
}: {
  compact?: boolean;
  fallbackSlug?: string;
  onProjectSelected?: (slug: string) => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const activeSlug = routeProject(pathname) ?? fallbackSlug;
  const { data: projects } = useAsyncData(getProjects, []);

  const onChange = (slug: string) => {
    onProjectSelected?.(slug);
    const publicMatch = pathname.match(/^\/app\/project\/([^/]+)/);
    const privateMatch = pathname.match(/^\/app\/dashboard\/projects\/([^/]+)/);
    if (publicMatch) {
      const suffix = pathname.slice(publicMatch[0].length);
      router.push(`/app/project/${slug}${suffix}`);
      return;
    }
    if (privateMatch) {
      const suffix = pathname.slice(privateMatch[0].length);
      router.push(`/app/dashboard/projects/${slug}${suffix}`);
      return;
    }
    router.push(`/app/project/${slug}`);
  };

  return (
    <label className={`project-selector ${compact ? "compact" : ""}`}>
      {!compact && <span>Current project</span>}
      <select value={activeSlug} onChange={(event) => onChange(event.target.value)} aria-label="Switch current project">
        {(projects ?? []).map((project) => <option key={project.slug} value={project.slug}>{project.name} · ${project.ticker}</option>)}
      </select>
    </label>
  );
}
