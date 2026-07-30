"use client";

import { useEffect, useMemo, useState } from "react";
import { PageTitle } from "@/components/PageTitle";
import { Panel, SectionHeader, StatusBadge } from "@/components/UI";
import { EmptyState, ErrorState, LoadingState, ProjectNotFound } from "@/components/data/AsyncState";
import { useAsyncData } from "@/components/data/useAsyncData";
import { useMode } from "@/components/mode/ModeProvider";
import { generateAgentReport, getProjectBundle } from "@/lib/services";
import type { ProjectBundle } from "@/lib/types";
import { ProjectNavigation } from "./ProjectNavigation";

export function AgentView({ slug }: { slug: string }) {
  const { mode } = useMode();
  const isLive = mode === "live";
  const { data: bundle, loading, error } = useAsyncData(() => getProjectBundle(slug), [slug]);
  const [liveBundle, setLiveBundle] = useState<ProjectBundle | null>(null);
  const [generating, setGenerating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => setLiveBundle(null), [bundle]);
  const effectiveBundle = liveBundle ?? bundle;
  const [reportIndex, setReportIndex] = useState(0);
  const grouped = useMemo(() => effectiveBundle ? {
    Pending: effectiveBundle.recommendations.filter((item) => item.status === "Pending"),
    Approved: effectiveBundle.recommendations.filter((item) => item.status === "Approved"),
    Rejected: effectiveBundle.recommendations.filter((item) => item.status === "Rejected"),
  } : null, [effectiveBundle]);
  if (loading) return <LoadingState label="Loading Treasury Agent reports"/>;
  if (error) return <ErrorState message={error}/>;
  if (!effectiveBundle || !grouped) return <ProjectNotFound slug={slug}/>;
  const { project, summary, reports } = effectiveBundle;
  const report = reports[reportIndex] ?? reports[0];

  const generateReview = async () => {
    if (!isLive || generating) return;
    setGenerating(true);
    setActionError(null);
    try {
      const updated = await generateAgentReport(slug);
      if (updated) { setLiveBundle(updated); setReportIndex(0); }
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Failed to generate treasury review.");
    } finally {
      setGenerating(false);
    }
  };
  const generateButton = <button className="primary-button" type="button" onClick={isLive ? () => void generateReview() : undefined} disabled={isLive && generating}>{isLive ? (generating ? "Generating…" : "Generate treasury review") : "Generate mock review"}</button>;

  const disclosure = <Panel className="agent-disclosure"><strong>The Treasury Agent monitors the balance sheet, identifies risk and proposes actions.</strong><span>It never controls the keys, signs transactions or overrides treasury policy.</span></Panel>;
  if (!summary || !report) {
    return <>
      <PageTitle eyebrow={`${project.name} · Treasury intelligence`} title="AGENT" subtitle="Monitors the balance sheet. Never controls the keys." action={isLive ? generateButton : undefined}/>
      <ProjectNavigation slug={slug} active="agent"/>
      {disclosure}
      {actionError && <div className="form-error">{actionError}</div>}
      <EmptyState title="No Agent reports yet" body={!summary ? "The treasury hasn't been indexed yet, so the Agent has no data to analyse." : isLive ? "Generate the first treasury review above to have the Agent propose recommendations." : "The Treasury Agent hasn't published a report for this project yet."}/>
    </>;
  }
  return <>
    <PageTitle eyebrow={`${project.name} · Treasury intelligence`} title="AGENT" subtitle="Monitors the balance sheet. Never controls the keys." action={generateButton}/>
    {actionError && <div className="form-error">{actionError}</div>}
    <ProjectNavigation slug={slug} active="agent"/>
    {disclosure}
    <div className="agent-page-grid"><Panel className="health-panel"><span className="mini-label">Financial health</span><h2>{summary.health}</h2><p>{report.summary}</p><div className="health-bars"><div><span>Reserve</span><i style={{width:`${Math.min(100,summary.reserve)}%`}}/></div><div><span>Policy compliance</span><i style={{width:`${summary.policyRulesPassing/summary.policyRulesTotal*100}%`}}/></div><div><span>Runway</span><i style={{width:`${Math.min(100,summary.runway/24*100)}%`}}/></div></div></Panel><Panel><SectionHeader title="Key metrics"/><div className="key-metrics"><div><span>USDG reserve</span><b>{summary.reserve}%</b></div><div><span>Minimum required</span><b>{summary.reserveTarget}%</b></div><div><span>Runway</span><b>{summary.runway} months</b></div><div><span>Rules passing</span><b>{summary.policyRulesPassing}/{summary.policyRulesTotal}</b></div></div></Panel></div>
    <Panel className="memo-panel"><SectionHeader title={report.title} action={<span className="mini-label">{report.createdAt}</span>}/><p>{report.summary}</p><div className="report-columns"><div><h3>Findings</h3><ul>{report.findings.map((finding)=><li key={finding}>{finding}</li>)}</ul></div><div><h3>Warnings</h3>{report.warnings.length ? <ul className="warning-list">{report.warnings.map((warning)=><li key={warning}>{warning}</li>)}</ul> : <p className="muted">No active warnings in this report.</p>}</div></div><div className="memo-callout"><span>Policy validation</span><strong>{report.policyValidation}</strong></div></Panel>
    <div className="proposal-columns">{(["Pending","Approved","Rejected"] as const).map((status)=><section key={status}><SectionHeader title={`${status} proposals`} action={<StatusBadge tone={status === "Approved" ? "green" : status === "Rejected" ? "red" : "lime"}>{grouped[status].length}</StatusBadge>}/>{grouped[status].map((recommendation)=><Panel key={recommendation.id} className="recommendation-card"><div><span className="mini-label">{recommendation.createdAt}</span><h3>{recommendation.title}</h3><strong>{recommendation.amount}</strong><p>{recommendation.rationale}</p><small>{recommendation.action}</small></div>{status === "Pending" && <a className="primary-button" href={`/app/dashboard/projects/${slug}/operator`}>Review proposal</a>}</Panel>)}</section>)}</div>
    <Panel><SectionHeader title="Report history"/><div className="report-history">{reports.map((item,index)=><button key={item.id} className={index===reportIndex?"active":""} onClick={()=>setReportIndex(index)}><div><strong>{item.title}</strong><span>{item.createdAt}</span></div><StatusBadge tone={item.health === "HEALTHY" ? "green" : item.health === "AT RISK" ? "red" : "lime"}>{item.health}</StatusBadge></button>)}</div></Panel>
  </>;
}
