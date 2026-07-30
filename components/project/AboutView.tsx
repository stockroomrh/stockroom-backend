"use client";

import { PageTitle } from "@/components/PageTitle";
import { Panel, SectionHeader, StatusBadge } from "@/components/UI";
import { ProjectMark } from "@/components/ProjectMark";
import { ErrorState, LoadingState, ProjectNotFound } from "@/components/data/AsyncState";
import { useAsyncData } from "@/components/data/useAsyncData";
import { shortenAddress } from "@/lib/format";
import { getProjectBundle } from "@/lib/services";
import { ProjectNavigation } from "./ProjectNavigation";

export function AboutView({ slug }: { slug: string }) {
  const { data: bundle, loading, error } = useAsyncData(() => getProjectBundle(slug), [slug]);
  if (loading) return <LoadingState label="Loading project disclosures"/>;
  if (error) return <ErrorState message={error}/>;
  if (!bundle) return <ProjectNotFound slug={slug}/>;
  const { project, policy } = bundle;
  return <>
    <PageTitle eyebrow={`${project.name} · Public disclosures`} title="ABOUT" subtitle="What the project is, what backs it and how it operates." action={<ProjectMark project={project}/>}/>
    <ProjectNavigation slug={slug} active="about"/>
    <div className="about-grid"><Panel className="large-copy-panel"><SectionHeader title="Project description"/><p>{project.description}</p><h3>Treasury objective</h3><p>{project.treasuryObjective}</p></Panel><Panel><SectionHeader title="Official information"/><div className="key-metrics"><div><span>Token ticker</span><b>${project.ticker}</b></div><div><span>Launch date</span><b>{project.launchDate}</b></div><div><span>Creator wallet</span><b>{shortenAddress(project.creatorWallet)}</b></div><div><span>Treasury address</span><b>{shortenAddress(project.treasuryAddress)}</b></div><div><span>Token contract</span><b>{shortenAddress(project.token.contract)}</b></div><div><span>Operator model</span><b>Human-approved</b></div></div></Panel></div>
    <div className="about-grid"><Panel><SectionHeader title="Official links"/><div className="official-links">{project.socials.website && <a href={project.socials.website} target="_blank" rel="noreferrer">Website ↗</a>}{project.socials.x && <a href={project.socials.x} target="_blank" rel="noreferrer">X / Twitter ↗</a>}{project.socials.telegram && <a href={project.socials.telegram} target="_blank" rel="noreferrer">Telegram ↗</a>}</div></Panel><Panel><SectionHeader title="Governance controls"/><div className="key-metrics"><div><span>Policy version</span><b>{policy.version}</b></div><div><span>Human approval</span><StatusBadge tone="green">Required</StatusBadge></div><div><span>Automated execution</span><StatusBadge tone="grey">Disabled</StatusBadge></div><div><span>Approved assets</span><b>{policy.approvedAssets.length}</b></div></div></Panel></div>
    <Panel className="disclosure-panel"><SectionHeader title="Risk and legal disclosure"/><p>Stockroom displays mocked frontend data in this prototype. Project tokens do not represent equity, shares, legal ownership of a treasury, or direct ownership of any underlying Stock Token or tokenized ETF. Public treasury information should be independently verified before financial decisions are made.</p></Panel>
  </>;
}
