"use client";

import Link from "next/link";
import { AllocationLegend, DonutChart, LineChart } from "@/components/Charts";
import { ActivityTable, HoldingsTable } from "@/components/Tables";
import { PageTitle } from "@/components/PageTitle";
import { MetricCard, Panel, SectionHeader, StatusBadge } from "@/components/UI";
import { EmptyState, ErrorState, LoadingState, ProjectNotFound } from "@/components/data/AsyncState";
import { useAsyncData } from "@/components/data/useAsyncData";
import { formatCurrency } from "@/lib/format";
import { getProjectBundle } from "@/lib/services";
import { ProjectNavigation } from "./ProjectNavigation";

export function TreasuryView({ slug }: { slug: string }) {
  const { data: bundle, loading, error } = useAsyncData(() => getProjectBundle(slug), [slug]);
  if (loading) return <LoadingState label="Loading balance sheet"/>;
  if (error) return <ErrorState message={error}/>;
  if (!bundle) return <ProjectNotFound slug={slug}/>;
  const { project, summary, history, positions, activity } = bundle;
  if (!summary) {
    return <>
      <PageTitle eyebrow={`${project.name} · Public balance sheet`} title="TREASURY" subtitle="Real assets. One open balance sheet."/>
      <ProjectNavigation slug={slug} active="treasury"/>
      <EmptyState title="No treasury data yet" body="This project's treasury address hasn't been indexed yet. Balances will appear here once the treasury has been read from chain."/>
    </>;
  }
  return <>
    <PageTitle eyebrow={`${project.name} · Public balance sheet`} title="TREASURY" subtitle="Real assets. One open balance sheet." action={<StatusBadge tone="green">Data {summary.chainStatus.toLowerCase()}</StatusBadge>}/>
    <ProjectNavigation slug={slug} active="treasury"/>
    <div className="metrics-grid"><MetricCard label="Total NAV" value={formatCurrency(summary.value)} note={`${summary.change30d >= 0 ? "+" : ""}${summary.change30d}% this month`} positive={summary.change30d >= 0}/><MetricCard label="USDG reserve" value={`${summary.reserve}%`} note={`${Math.abs(summary.reserve-summary.reserveTarget)}% ${summary.reserve >= summary.reserveTarget ? "above" : "below"} target`}/><MetricCard label="Revenue 30D" value={formatCurrency(summary.revenue30d,0)} note="Recorded inflows" positive/><MetricCard label="Expenses 30D" value={formatCurrency(summary.expenses30d,0)} note={`${Math.round(summary.expenses30d/Math.max(1,summary.revenue30d)*100)}% of revenue`}/></div>
    <div className="treasury-top-grid"><Panel><SectionHeader title="Full NAV history" action={<div className="period-pills"><button>7D</button><button className="active">30D</button><button>90D</button><button>1Y</button></div>}/><LineChart values={history}/><div className="chart-axis"><span>{history[0]?.date}</span><span>{history[Math.floor(history.length/2)]?.date}</span><span>{history.at(-1)?.date}</span></div></Panel><Panel><SectionHeader title="Current allocation"/><div className="allocation-layout vertical"><DonutChart positions={positions}/><AllocationLegend positions={positions}/></div></Panel></div>
    <Panel><SectionHeader title="Holdings" action={<button className="secondary-button" type="button">Export CSV</button>}/><HoldingsTable positions={positions} projectSlug={slug}/></Panel>
    <div className="finance-grid"><Panel><SectionHeader title="Balance sheet"/><div className="balance-sheet"><div><span>Total assets</span><strong>{formatCurrency(summary.value)}</strong></div><div><span>USDG reserves</span><strong>{formatCurrency(summary.value * summary.reserve/100)}</strong></div><div><span>Risk assets</span><strong>{formatCurrency(summary.value * (100-summary.reserve)/100)}</strong></div><div><span>Net treasury position</span><strong>{formatCurrency(summary.value)}</strong></div></div></Panel><Panel><SectionHeader title="Treasury flows · 30D"/><div className="balance-sheet"><div><span>Revenue</span><strong>{formatCurrency(summary.revenue30d)}</strong></div><div><span>Expenses</span><strong>{formatCurrency(summary.expenses30d)}</strong></div><div><span>Deposits</span><strong>{formatCurrency(summary.deposits30d)}</strong></div><div><span>Withdrawals</span><strong>{formatCurrency(summary.withdrawals30d)}</strong></div></div></Panel><Panel><SectionHeader title="Operating runway"/><div className="runway-display"><strong>{summary.runway}</strong><span>months</span><p>Based on recorded recurring expenses and current liquid reserves.</p></div></Panel></div>
    <Panel><SectionHeader title="Transaction feed" action={<Link href={`/app/project/${slug}/activity`}>Open complete ledger</Link>}/><ActivityTable items={activity}/></Panel>
  </>;
}
