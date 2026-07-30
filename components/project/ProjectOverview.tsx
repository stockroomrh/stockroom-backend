"use client";

import Link from "next/link";
import { AllocationLegend, DonutChart, LineChart } from "@/components/Charts";
import { ActivityTable, HoldingsTable } from "@/components/Tables";
import { MetricCard, Panel, SectionHeader, StatusBadge } from "@/components/UI";
import { ProjectMark } from "@/components/ProjectMark";
import { EmptyState, ErrorState, LoadingState, ProjectNotFound } from "@/components/data/AsyncState";
import { useAsyncData } from "@/components/data/useAsyncData";
import { formatCompactCurrency, formatCurrency, shortenAddress } from "@/lib/format";
import { getProjectBundle } from "@/lib/services";
import { ProjectNavigation } from "./ProjectNavigation";

export function ProjectOverview({ slug }: { slug: string }) {
  const { data: bundle, loading, error } = useAsyncData(() => getProjectBundle(slug), [slug]);
  if (loading) return <LoadingState label="Loading public project"/>;
  if (error) return <ErrorState message={error}/>;
  if (!bundle) return <ProjectNotFound slug={slug}/>;
  const { project, summary, positions, history, reports, recommendations, activity } = bundle;
  const latestReport = reports[0];
  const latestRecommendation = recommendations.find((item) => item.status === "Pending") ?? recommendations[0];

  const bannerImage = project.bannerUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={project.bannerUrl} alt="" className="project-banner"/>
  ) : null;

  if (!summary) {
    return <>
      {bannerImage}
      <section className="project-hero">
        <div className="project-identity"><ProjectMark project={project} size="large"/><div><div className="eyebrow">${project.ticker} · Public project</div><h1>{project.name}</h1><p>{project.shortDescription}</p></div></div>
        <div className="project-hero-actions"><Link className="primary-button" href={`/app/dashboard/projects/${slug}`}>Manage project</Link><a className="secondary-button" href={project.socials.website ?? "#"} target="_blank" rel="noreferrer">Project website ↗</a></div>
      </section>
      <ProjectNavigation slug={slug} active="overview"/>
      <EmptyState title="Treasury not indexed yet" body="This project's treasury address hasn't been read from chain yet. Its public balance sheet, Agent reports and activity will appear here once indexing begins."/>
    </>;
  }

  return <>
    {bannerImage}
    <section className="project-hero">
      <div className="project-identity"><ProjectMark project={project} size="large"/><div><div className="eyebrow">${project.ticker} · Public project</div><h1>{project.name}</h1><p>{project.shortDescription}</p></div></div>
      <div className="project-hero-actions"><StatusBadge tone={summary.health === "HEALTHY" ? "green" : summary.health === "AT RISK" ? "red" : "lime"}>{summary.health}</StatusBadge><Link className="primary-button" href={`/app/dashboard/projects/${slug}`}>Manage project</Link><a className="secondary-button" href={project.socials.website ?? "#"} target="_blank" rel="noreferrer">Project website ↗</a></div>
    </section>
    <ProjectNavigation slug={slug} active="overview"/>
    <Panel className="public-summary-bar"><div><span>Token price</span><strong>{formatCurrency(project.token.price, 4)}</strong></div><div><span>Market cap</span><strong>{formatCompactCurrency(project.token.marketCap)}</strong></div><div><span>Token contract</span><strong>{shortenAddress(project.token.contract)}</strong></div><div><span>Treasury address</span><strong>{shortenAddress(project.treasuryAddress)}</strong></div></Panel>
    <div className="metrics-grid">
      <MetricCard label="Treasury value" value={formatCurrency(summary.value)} note={`${summary.change30d >= 0 ? "+" : ""}${summary.change30d}% over 30D`} positive={summary.change30d >= 0}/>
      <MetricCard label="USDG reserve" value={`${summary.reserve}%`} note={`Policy target: ${summary.reserveTarget}%`}/>
      <MetricCard label="30-day change" value={`${summary.change30d >= 0 ? "+" : ""}${summary.change30d}%`} note={formatCurrency(summary.change30dUsd)} positive={summary.change30d >= 0}/>
      <MetricCard label="Operating runway" value={`${summary.runway}`} note="Months"/>
    </div>
    <div className="overview-grid">
      <Panel className="chart-panel"><SectionHeader title="Public treasury value" action={<span className="mini-label">30 days</span>}/><LineChart values={history}/><div className="chart-axis"><span>{history[0]?.date}</span><span>{history[Math.floor(history.length/2)]?.date}</span><span>{history.at(-1)?.date}</span></div></Panel>
      <Panel className="agent-preview"><div className="agent-orb">☺</div><span className="mini-label">Treasury Agent</span><h2>{summary.health}</h2><p>{latestReport?.summary ?? "No Agent reports published yet."}</p>{latestRecommendation && <div className="recommendation-mini"><span>Latest proposal</span><b>{latestRecommendation.title}</b><small>{latestRecommendation.action}</small></div>}<Link className="primary-button" href={`/app/project/${slug}/agent`}>Open Agent report</Link></Panel>
    </div>
    <div className="lower-grid"><Panel><SectionHeader title="Asset allocation"/><div className="allocation-layout"><DonutChart positions={positions}/><AllocationLegend positions={positions}/></div></Panel><Panel className="holdings-panel"><SectionHeader title="Treasury holdings" action={<Link href={`/app/project/${slug}/treasury`}>View full balance sheet</Link>}/><HoldingsTable positions={positions.slice(0,4)} compact projectSlug={slug}/></Panel></div>
    {latestReport && <Panel className="memo-panel"><SectionHeader title="Latest public treasury memo" action={<span className="mini-label">{latestReport.createdAt}</span>}/><p>{latestReport.summary}</p>{latestRecommendation && <div className="memo-callout"><span>Human-approved proposal</span><strong>{latestRecommendation.title}: {latestRecommendation.amount}</strong><small>{latestRecommendation.rationale}</small></div>}</Panel>}
    <Panel className="activity-panel"><SectionHeader title="Recent public activity" action={<Link href={`/app/project/${slug}/activity`}>View complete ledger</Link>}/><ActivityTable items={activity.slice(0,4)}/></Panel>
    <div className="status-strip"><span><i/>{summary.chainStatus === "Live" ? "Robinhood Chain live" : "Chain degraded"}</span><span>Data updated {summary.updated}</span><StatusBadge>Policy v{bundle.policy.version}</StatusBadge></div>
  </>;
}
