"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Logo } from "./Logo";
import { ProjectSelector } from "./ProjectSelector";
import { ModeToggle } from "./mode/ModeToggle";
import { ModeBanner } from "./mode/ModeBanner";
import { useMode } from "./mode/ModeProvider";
import { WalletButton } from "./mode/WalletButton";

const LAST_PROJECT_KEY = "stockroom:last-project";
const platformLinks = [
  ["Explore", "/app/explore"],
  ["Launch", "/app/launch"],
  ["My Projects", "/app/dashboard"],
  ["Ops", "/app/dashboard/ops"],
] as const;

function routeProject(pathname: string) {
  return pathname.match(/^\/app\/project\/([^/]+)/)?.[1]
    ?? pathname.match(/^\/app\/dashboard\/projects\/([^/]+)/)?.[1]
    ?? null;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { mode } = useMode();
  const pathSlug = routeProject(pathname);
  const [lastProject, setLastProject] = useState(pathSlug ?? "stockroom");

  useEffect(() => {
    const saved = window.localStorage.getItem(LAST_PROJECT_KEY);
    if (!pathSlug && saved) setLastProject(saved);
  }, []);

  useEffect(() => {
    if (!pathSlug) return;
    setLastProject(pathSlug);
    window.localStorage.setItem(LAST_PROJECT_KEY, pathSlug);
  }, [pathSlug]);

  const slug = pathSlug ?? lastProject;
  const projectLinks = [
    ["Overview", `/app/project/${slug}`],
    ["Token", `/app/project/${slug}/token`],
    ["Treasury", `/app/project/${slug}/treasury`],
    ["Agent", `/app/project/${slug}/agent`],
    ["Activity", `/app/project/${slug}/activity`],
    ["Policy", `/app/project/${slug}/policy`],
    ["About", `/app/project/${slug}/about`],
    ["Manage", `/app/dashboard/projects/${slug}`],
  ] as const;

  const setProject = (nextSlug: string) => {
    setLastProject(nextSlug);
    window.localStorage.setItem(LAST_PROJECT_KEY, nextSlug);
  };

  const isPlatformActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const isProjectActive = (label: string, href: string) => {
    if (label === "Overview") return pathname === href;
    if (label === "Manage") return pathname.startsWith(`/app/dashboard/projects/${slug}`);
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <div className="app-bg">
      <div className="blue-art blue-art-a" />
      <div className="blue-art blue-art-b" />
      <header className="topbar">
        <Link href={`/app/project/${slug}`} className="brand-pill" aria-label="Open current project overview"><Logo /></Link>
        <nav className="pill-nav platform-nav" aria-label="Platform navigation">
          {platformLinks.map(([label, href]) => <Link key={href} href={href} className={isPlatformActive(href) ? "active" : ""}>{label}</Link>)}
        </nav>
        <div className="topbar-actions">
          <ModeToggle />
          <WalletButton />
        </div>
      </header>
      <ModeBanner />
      <section className="workspace-bar" aria-label="Current project workspace">
        <div className="workspace-project">
          <span>Current project</span>
          <ProjectSelector compact fallbackSlug={slug} onProjectSelected={setProject}/>
        </div>
        <nav className="workspace-links" aria-label="Project navigation">
          {projectLinks.map(([label, href]) => <Link key={label} href={href} className={isProjectActive(label, href) ? "active" : ""}>{label}</Link>)}
        </nav>
      </section>
      <main className="app-main" data-mode={mode}>{children}</main>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        <Link href={`/app/project/${slug}`} className={pathname === `/app/project/${slug}` ? "active" : ""}><span>⌂</span>Overview</Link>
        <Link href="/app/explore" className={pathname.startsWith("/app/explore") ? "active" : ""}><span>◉</span>Explore</Link>
        <Link href="/app/launch" className={pathname.startsWith("/app/launch") ? "active" : ""}><span>＋</span>Launch</Link>
        <Link href="/app/dashboard" className={pathname === "/app/dashboard" || pathname === "/app/dashboard/projects" ? "active" : ""}><span>▦</span>Projects</Link>
        <Link href={`/app/dashboard/projects/${slug}`} className={pathname.startsWith(`/app/dashboard/projects/${slug}`) ? "active" : ""}><span>⚙</span>Manage</Link>
      </nav>
    </div>
  );
}
