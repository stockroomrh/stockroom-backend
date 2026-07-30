"use client";

import Link from "next/link";
import { PageTitle } from "@/components/PageTitle";
import { MetricCard, Panel, SectionHeader, StatusBadge } from "@/components/UI";
import { ProjectMark } from "@/components/ProjectMark";
import { ErrorState, LoadingState } from "@/components/data/AsyncState";
import { useAsyncData } from "@/components/data/useAsyncData";
import { useMode } from "@/components/mode/ModeProvider";
import { useAuth } from "@/components/mode/AuthProvider";
import { formatCompactCurrency, shortenAddress } from "@/lib/format";
import { getUserProjects } from "@/lib/services";
import { JourneyGuide } from "@/components/JourneyGuide";

export function DashboardView({ projectsOnly = false }: { projectsOnly?: boolean }) {
  const { mode } = useMode();
  const isLive = mode === "live";
  const { walletAddress } = useAuth();
  const { data: projects, loading, error } = useAsyncData(getUserProjects, []);
  if (loading) return <LoadingState label="Loading creator workspace"/>;
  if (error) return <ErrorState message={error}/>;
  const items = projects ?? [];
  const pending = items.reduce((total,item)=>total+item.pendingRecommendations,0);
  const alerts = items.filter((item)=>item.summary && item.summary.health!=="HEALTHY").length;
  const drafts = items.filter((item)=>item.operationalStatus==="Draft").length;
  return <>
    <PageTitle eyebrow={isLive ? "Live authenticated workspace" : "Mock authenticated workspace"} title={projectsOnly?"MY PROJECTS":"DASHBOARD"} subtitle={projectsOnly?"Every project you operate through Stockroom.":"Manage projects, recommendations and treasury alerts."} action={<Link className="primary-button" href="/app/launch">Launch new project</Link>}/>
    {!projectsOnly && <><JourneyGuide compact/><Panel className="auth-strip"><div><span className="auth-dot"/><div><strong>{isLive ? (walletAddress ? `Connected as ${shortenAddress(walletAddress)}` : "Not connected") : "Connected as 0x7A3F…92C1"}</strong><span>{isLive ? "Live wallet authentication" : "Frontend-only mock authentication"}</span></div></div><StatusBadge tone="green">Owner access</StatusBadge></Panel><div className="metrics-grid"><MetricCard label="My projects" value={`${items.length}`} note="Live Stockroom projects"/><MetricCard label="Pending actions" value={`${pending}`} note="Human review required"/><MetricCard label="Treasury alerts" value={`${alerts}`} note={alerts?"Needs attention":"All clear"}/><MetricCard label="Draft launches" value={`${drafts}`} note={isLive ? "Not yet published" : "Saved locally"}/></div></>}
    <Panel><SectionHeader title="My projects" action={!projectsOnly?<Link href="/app/dashboard/projects">View all projects</Link>:undefined}/><div className="managed-projects">{items.map((item)=><article key={item.project.slug}><div className="managed-project-identity"><ProjectMark project={item.project}/><div><strong>{item.project.name}</strong><span>${item.project.ticker} · {item.role}</span></div></div><div><span>Treasury value</span><b>{item.summary ? formatCompactCurrency(item.summary.value) : "—"}</b></div><div><span>Reserve</span><b>{item.summary ? `${item.summary.reserve}%` : "—"}</b></div><div><span>Pending</span><b>{item.pendingRecommendations}</b></div><StatusBadge tone={!item.summary?"grey":item.summary.health==="HEALTHY"?"green":item.summary.health==="AT RISK"?"red":"lime"}>{item.summary?.health ?? "Not indexed"}</StatusBadge><div className="managed-project-actions"><Link className="secondary-button" href={`/app/project/${item.project.slug}`}>Public page</Link><Link className="primary-button" href={`/app/dashboard/projects/${item.project.slug}`}>Manage</Link></div></article>)}</div></Panel>
    {!projectsOnly && <div className="dashboard-lower"><Panel><SectionHeader title="Treasury alerts"/><div className="alert-list">{items.filter((item)=>item.summary && item.summary.health!=="HEALTHY").map((item)=><Link key={item.project.slug} href={`/app/dashboard/projects/${item.project.slug}/operator`}><StatusBadge tone={item.summary?.health==="AT RISK"?"red":"lime"}>{item.summary?.health}</StatusBadge><div><strong>{item.project.name}</strong><span>Reserve is {item.summary?.reserve}% against a {item.summary?.reserveTarget}% target.</span></div><b>Review →</b></Link>)}</div></Panel><Panel><SectionHeader title="Recent operator activity"/><div className="operator-activity-list">{items.slice(0,4).map((item)=><div key={item.project.slug}><ProjectMark project={item.project} size="small"/><div><strong>{item.latestActivity?.description ?? "Project created"}</strong><span>{item.project.name} · {item.latestActivity?.time ?? "Just now"}</span></div></div>)}</div></Panel></div>}
  </>;
}
