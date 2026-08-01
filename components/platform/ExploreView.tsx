"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageTitle } from "@/components/PageTitle";
import { Panel, StatusBadge } from "@/components/UI";
import { ProjectMark } from "@/components/ProjectMark";
import { ErrorState, LoadingState } from "@/components/data/AsyncState";
import { useAsyncData } from "@/components/data/useAsyncData";
import { formatCompactCurrency, formatCurrency } from "@/lib/format";
import { getProjectBundle, getProjects } from "@/lib/services";
import type { ProjectBundle } from "@/lib/types";
import { JourneyGuide } from "@/components/JourneyGuide";
import { isTestProject } from "@/lib/test-projects";

const filters = ["Trending", "New", "Largest Treasury", "Best Reserve Ratio", "Recently Active"] as const;

export function ExploreView() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof filters)[number]>("Trending");
  const { data: projectBundles, loading, error } = useAsyncData(async () => {
    const projects = await getProjects();
    return (await Promise.all(projects.map((project) => getProjectBundle(project.slug)))).filter(Boolean) as ProjectBundle[];
  }, []);

  const visible = useMemo(() => {
    const match = (projectBundles ?? []).filter(({ project }) => `${project.name} ${project.ticker}`.toLowerCase().includes(query.toLowerCase().trim()));
    return [...match].sort((a,b) => {
      if (filter === "Largest Treasury") return (b.summary?.value ?? 0) - (a.summary?.value ?? 0);
      if (filter === "Best Reserve Ratio") return (b.summary?.reserve ?? 0) - (a.summary?.reserve ?? 0);
      if (filter === "New") return new Date(b.project.token.deploymentDate).getTime() - new Date(a.project.token.deploymentDate).getTime();
      if (filter === "Recently Active") return (a.summary?.updated ?? "").localeCompare(b.summary?.updated ?? "");
      return b.project.trendingScore - a.project.trendingScore;
    });
  }, [projectBundles, query, filter]);

  if (loading) return <LoadingState label="Loading Stockroom projects"/>;
  if (error) return <ErrorState message={error}/>;
  return <>
    <PageTitle eyebrow="Public project registry" title="EXPLORE" subtitle="Discover tokens with public balance sheets." action={<Link className="primary-button" href="/app/launch">Launch a project</Link>}/>
    <JourneyGuide/>
    <section className="explore-toolbar"><label className="search-box"><span>Search</span><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Project name or ticker"/></label><div className="filter-pills">{filters.map((item)=><button key={item} className={filter===item?"active":""} onClick={()=>setFilter(item)}>{item}</button>)}</div></section>
    <div className="featured-statement"><span>Launch standard</span><strong>Token + treasury + policy + public balance sheet.</strong><p>Every project below uses the same transparent Stockroom project structure.</p></div>
    <div className="project-card-grid">{visible.map(({project,summary,reports})=><Link href={`/app/project/${project.slug}`} key={project.slug} className="project-card"><div className="project-card-top"><ProjectMark project={project}/><div><strong>{project.name}</strong><span>${project.ticker}</span></div>{isTestProject(project.slug) && <StatusBadge tone="grey">TESTNET</StatusBadge>}{summary && <StatusBadge tone={summary.health==="HEALTHY"?"green":summary.health==="AT RISK"?"red":"lime"}>{summary.health}</StatusBadge>}</div><p>{project.shortDescription}</p>{summary ? <div className="project-card-metrics"><div><span>Treasury</span><b>{formatCompactCurrency(summary.value)}</b></div><div><span>USDG reserve</span><b>{summary.reserve}%</b></div><div><span>30D change</span><b className={summary.change30d>=0?"positive":"negative"}>{summary.change30d>=0?"+":""}{summary.change30d}%</b></div><div><span>Market cap</span><b>{formatCompactCurrency(project.token.marketCap)}</b></div></div> : <div className="project-card-metrics"><div><span>Treasury</span><b>Not indexed yet</b></div></div>}<div className="agent-note"><span>Treasury Agent</span><p>{reports[0]?.summary ?? "No reports yet."}</p></div><div className="project-card-footer"><span>Launched {project.launchDate}</span><b>{formatCurrency(project.token.price,4)} ↗</b></div></Link>)}</div>
    {!visible.length && <Panel className="state-panel"><strong>No matching projects</strong><span>Try another name, ticker or filter.</span></Panel>}
  </>;
}
