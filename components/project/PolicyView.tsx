"use client";

import { PageTitle } from "@/components/PageTitle";
import { Panel, SectionHeader, StatusBadge } from "@/components/UI";
import { ErrorState, LoadingState, ProjectNotFound } from "@/components/data/AsyncState";
import { useAsyncData } from "@/components/data/useAsyncData";
import { getProjectBundle } from "@/lib/services";
import { ProjectNavigation } from "./ProjectNavigation";
import { SupportedAssets } from "@/components/SupportedAssets";

export function PolicyView({ slug }: { slug: string }) {
  const { data: bundle, loading, error } = useAsyncData(() => getProjectBundle(slug), [slug]);
  if (loading) return <LoadingState label="Loading treasury policy"/>;
  if (error) return <ErrorState message={error}/>;
  if (!bundle) return <ProjectNotFound slug={slug}/>;
  const { project, policy } = bundle;
  const rules = [
    ["Minimum USDG reserve", policy.minimumReserve, "Percentage of NAV that must remain in USDG"],
    ["Maximum single asset", policy.maximumSingleAsset, "Maximum allocation to one non-reserve asset"],
    ["Maximum crypto allocation", policy.maximumCrypto, "Combined maximum crypto exposure"],
    ["Maximum trade size", policy.maximumTrade, "Maximum percentage of NAV per proposal"],
  ] as const;
  return <>
    <PageTitle eyebrow={`${project.name} · Deterministic mandate`} title="TREASURY POLICY" subtitle="Set the rules before capital moves." action={<StatusBadge>Version {policy.version}</StatusBadge>}/>
    <ProjectNavigation slug={slug} active="policy"/>
    <div className="policy-grid"><div className="rules-stack">{rules.map(([name,value,description])=><Panel key={name} className="rule-card"><div><h3>{name}</h3><p>{description}</p></div><strong>{value}%</strong><div className="range-track"><i style={{width:`${value}%`}}/></div></Panel>)}</div><Panel><SectionHeader title="Execution controls"/><div className="key-metrics"><div><span>Human approval</span><StatusBadge tone={policy.humanApproval?"green":"red"}>{policy.humanApproval?"Required":"Disabled"}</StatusBadge></div><div><span>Automated execution</span><StatusBadge tone={policy.automatedExecution?"green":"grey"}>{policy.automatedExecution?"Active":"Off"}</StatusBadge></div><div><span>Policy updated</span><b>{policy.updatedAt}</b></div><div><span>Current version</span><b>{policy.version}</b></div></div><div className="policy-lock-note"><strong>Keys remain human-controlled.</strong><p>The Treasury Agent can validate and propose actions but cannot sign, move funds or change this policy.</p></div></Panel></div>
    <Panel><SectionHeader title="Supported assets and limits"/><SupportedAssets rules={policy.assetRules} readOnly/></Panel>
    <Panel><SectionHeader title="Policy history"/><div className="history-list">{policy.history.map((item)=><div key={item.version}><span>{item.date}</span><div><strong>Version {item.version}</strong><small>{item.summary}</small></div><StatusBadge tone={item.version===policy.version?"lime":"grey"}>{item.version===policy.version?"Current":"Archived"}</StatusBadge></div>)}</div></Panel>
  </>;
}
