"use client";

import Link from "next/link";
import { PageTitle } from "@/components/PageTitle";
import { Panel, SectionHeader, StatusBadge } from "@/components/UI";
import { ErrorState, LoadingState, EmptyState } from "@/components/data/AsyncState";
import { useAsyncData } from "@/components/data/useAsyncData";
import type { OpsSummaryRow } from "@/app/api/admin/ops-summary/route";

async function fetchOpsSummary(): Promise<OpsSummaryRow[]> {
  const response = await fetch("/api/admin/ops-summary", { cache: "no-store" });
  if (response.status === 401) return [];
  if (!response.ok) throw new Error(`Failed to load ops summary (${response.status})`);
  return (await response.json()) as OpsSummaryRow[];
}

function syncHealth(row: OpsSummaryRow): { tone: "green" | "red" | "grey"; label: string } {
  if (row.lastSyncError) return { tone: "red", label: "Sync failing" };
  if (!row.lastSyncedAt) return { tone: "grey", label: "Never synced" };
  const ageHours = (Date.now() - new Date(row.lastSyncedAt).getTime()) / (1000 * 60 * 60);
  if (ageHours > 24) return { tone: "grey", label: "Stale (24h+)" };
  return { tone: "green", label: "Healthy" };
}

export function AdminOpsView() {
  const { data: rows, loading, error } = useAsyncData(fetchOpsSummary, []);
  if (loading) return <LoadingState label="Loading ops summary"/>;
  if (error) return <ErrorState message={error}/>;
  const items = rows ?? [];

  const issues = items.filter((row) => row.lastSyncError || row.pendingApprovedAssetSymbols.length > 0 || (row.status === "published" && !row.tokenDeployed));

  return <>
    <PageTitle eyebrow="Operator visibility" title="OPS" subtitle="Health signals across every project you operate — sync status, launch status, and configuration gaps."/>
    {items.length === 0 ? (
      <EmptyState title="No projects yet" body="Projects you own or operate will show up here once you have at least one."/>
    ) : <>
      {issues.length > 0 && (
        <Panel className="ops-issues-panel">
          <SectionHeader title="Needs attention" action={<StatusBadge tone="red">{issues.length}</StatusBadge>}/>
          <div className="ops-issue-list">
            {issues.map((row) => (
              <Link key={row.slug} href={`/app/dashboard/projects/${row.slug}`} className="ops-issue-row">
                <strong>{row.name}</strong>
                <div className="ops-issue-tags">
                  {row.lastSyncError && <StatusBadge tone="red">Sync error</StatusBadge>}
                  {row.status === "published" && !row.tokenDeployed && <StatusBadge tone="grey">Token not launched</StatusBadge>}
                  {row.pendingApprovedAssetSymbols.length > 0 && <StatusBadge tone="grey">{row.pendingApprovedAssetSymbols.length} unverified asset{row.pendingApprovedAssetSymbols.length === 1 ? "" : "s"}</StatusBadge>}
                </div>
              </Link>
            ))}
          </div>
        </Panel>
      )}
      <Panel>
        <SectionHeader title="All projects" action={<StatusBadge tone="green">{items.length}</StatusBadge>}/>
        <div className="ops-table">
          <div className="ops-table-head">
            <span>Project</span><span>Role</span><span>Sync</span><span>Token</span><span>Trading</span><span>Assets</span>
          </div>
          {items.map((row) => {
            const health = syncHealth(row);
            return <Link key={row.slug} href={`/app/dashboard/projects/${row.slug}`} className="ops-table-row">
              <span><strong>{row.name}</strong><small className="muted">${row.slug}</small></span>
              <span>{row.role}</span>
              <span><StatusBadge tone={health.tone}>{health.label}</StatusBadge>{row.lastSyncedAt && <small className="muted">{new Date(row.lastSyncedAt).toLocaleString()}</small>}</span>
              <span><StatusBadge tone={row.tokenDeployed ? "green" : "grey"}>{row.tokenDeployed ? (row.launchProvider === "pons" ? "Launched (Pons)" : "Deployed") : "Not launched"}</StatusBadge></span>
              <span><StatusBadge tone={row.tradingPaused ? "red" : "green"}>{row.tradingPaused ? "Paused" : "Active"}</StatusBadge></span>
              <span>{row.pendingApprovedAssetSymbols.length > 0 ? <StatusBadge tone="grey">{row.pendingApprovedAssetSymbols.length} pending</StatusBadge> : <StatusBadge tone="green">OK</StatusBadge>}</span>
            </Link>;
          })}
        </div>
      </Panel>
    </>}
  </>;
}
