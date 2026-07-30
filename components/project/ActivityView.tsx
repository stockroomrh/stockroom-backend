"use client";

import { useMemo, useState } from "react";
import { PageTitle } from "@/components/PageTitle";
import { ActivityTable } from "@/components/Tables";
import { Panel, SectionHeader } from "@/components/UI";
import { ErrorState, LoadingState, ProjectNotFound } from "@/components/data/AsyncState";
import { useAsyncData } from "@/components/data/useAsyncData";
import { formatCurrency } from "@/lib/format";
import { getProjectBundle } from "@/lib/services";
import type { ActivityType } from "@/lib/types";
import { ProjectNavigation } from "./ProjectNavigation";

const filters: ("All" | ActivityType)[] = ["All", "Deposit", "Withdrawal", "Trade", "Revenue", "Expense", "Unclassified"];

export function ActivityView({ slug }: { slug: string }) {
  const { data: bundle, loading, error } = useAsyncData(() => getProjectBundle(slug), [slug]);
  const [filter, setFilter] = useState<(typeof filters)[number]>("All");
  const filtered = useMemo(() => bundle?.activity.filter((item) => filter === "All" || item.type === filter) ?? [], [bundle, filter]);
  if (loading) return <LoadingState label="Loading public ledger"/>;
  if (error) return <ErrorState message={error}/>;
  if (!bundle) return <ProjectNotFound slug={slug}/>;
  const inflows = (bundle.summary?.deposits30d ?? 0) + (bundle.summary?.revenue30d ?? 0);
  const outflows = (bundle.summary?.withdrawals30d ?? 0) + (bundle.summary?.expenses30d ?? 0);
  return <>
    <PageTitle eyebrow={`${bundle.project.name} · Public ledger`} title="ACTIVITY" subtitle="Every movement. Publicly verifiable." action={<button className="secondary-button" type="button">Download ledger</button>}/>
    <ProjectNavigation slug={slug} active="activity"/>
    <div className="filter-pills">{filters.map((item)=><button key={item} className={filter===item?"active":""} onClick={()=>setFilter(item)}>{item === "Deposit" ? "Deposits" : item === "Withdrawal" ? "Withdrawals" : item === "Trade" ? "Trades" : item === "Expense" ? "Expenses" : item}</button>)}</div>
    <Panel><SectionHeader title="Treasury ledger" action={<span className="mini-label">{filtered.length} records</span>}/><ActivityTable items={filtered}/></Panel>
    <div className="activity-stats"><Panel><span>Total inflows</span><strong>{formatCurrency(inflows,0)}</strong><small>Last 30 days</small></Panel><Panel><span>Total outflows</span><strong>{formatCurrency(outflows,0)}</strong><small>Last 30 days</small></Panel><Panel><span>Confirmed trades</span><strong>{bundle.activity.filter((item)=>item.type==="Trade" && item.status==="Confirmed").length}</strong><small>Visible ledger entries</small></Panel></div>
  </>;
}
