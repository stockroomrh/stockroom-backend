"use client";

import Link from "next/link";
import { PageTitle } from "@/components/PageTitle";
import { MetricCard, Panel, SectionHeader, StatusBadge } from "@/components/UI";
import { ErrorState, LoadingState, ProjectNotFound } from "@/components/data/AsyncState";
import { useAsyncData } from "@/components/data/useAsyncData";
import { formatCurrency, shortenAddress } from "@/lib/format";
import { getProjectAsset, getProjectBySlug } from "@/lib/services";

export function AssetView({ slug, symbol }: { slug: string; symbol: string }) {
  const { data, loading, error } = useAsyncData(async () => {
    const [project, asset] = await Promise.all([getProjectBySlug(slug), getProjectAsset(slug, symbol)]);
    return { project, asset };
  }, [slug, symbol]);
  if (loading) return <LoadingState label="Loading treasury asset"/>;
  if (error) return <ErrorState message={error}/>;
  if (!data?.project) return <ProjectNotFound slug={slug}/>;
  if (!data.asset) return <Panel className="state-panel"><strong>Asset not found</strong><span>{data.project.name} does not currently hold {symbol}.</span><Link className="primary-button" href={`/app/project/${slug}/treasury`}>Back to treasury</Link></Panel>;
  const { asset, project } = data;
  return <>
    <PageTitle eyebrow={`${project.name} treasury position`} title={asset.symbol} subtitle={asset.name} action={<StatusBadge tone={asset.freshness==="Live"?"green":"lime"}>{asset.freshness} market data</StatusBadge>}/>
    <div className="asset-back"><Link href={`/app/project/${slug}/treasury`}>← Back to {project.name} treasury</Link></div>
    <div className="metrics-grid"><MetricCard label="Treasury position" value={asset.balance} note={asset.symbol}/><MetricCard label="Position value" value={formatCurrency(asset.value)} note={`${asset.allocation}% of NAV`}/><MetricCard label="Average acquisition" value={formatCurrency(asset.averageAcquisitionPrice)} note={`Current: ${formatCurrency(asset.price)}`} positive={asset.price>=asset.averageAcquisitionPrice}/><MetricCard label="24-hour movement" value={`${asset.change24h>=0?"+":""}${asset.change24h}%`} note={asset.priceSource} positive={asset.change24h>=0}/></div>
    <div className="asset-detail-grid"><Panel><SectionHeader title="Position information"/><div className="key-metrics"><div><span>Asset type</span><b>{asset.type}</b></div><div><span>Allocation</span><b>{asset.allocation}%</b></div><div><span>Multiplier</span><b>{asset.multiplier}×</b></div><div><span>Price source</span><b>{asset.priceSource}</b></div><div><span>Canonical contract</span><a className="inline-link" href={asset.contractUrl} target="_blank" rel="noreferrer">{shortenAddress(asset.contract)} ↗</a></div><div><span>Market-data status</span><StatusBadge tone={asset.freshness==="Live"?"green":"lime"}>{asset.freshness}</StatusBadge></div></div></Panel><Panel><SectionHeader title="Treasury context"/><p className="large-copy">This position belongs to the public {project.name} treasury. The project token does not grant legal ownership of this asset or the treasury.</p><div className="policy-lock-note"><strong>Human-approved execution</strong><p>Any purchase or sale must pass policy validation and be signed by an authorised wallet.</p></div></Panel></div>
    <Panel><SectionHeader title="Recent purchases and sales"/><div className="trade-history">{asset.recentTrades.map((trade)=><div key={trade.id}><StatusBadge tone={trade.side==="Buy"?"green":"red"}>{trade.side}</StatusBadge><div><strong>{trade.amount}</strong><span>{trade.date}</span></div><b>{formatCurrency(trade.value)}</b></div>)}</div></Panel>
  </>;
}
