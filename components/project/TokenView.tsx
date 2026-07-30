"use client";

import { DistributionBars } from "@/components/Charts";
import { PageTitle } from "@/components/PageTitle";
import { MetricCard, Panel, SectionHeader, StatusBadge } from "@/components/UI";
import { ErrorState, LoadingState, ProjectNotFound } from "@/components/data/AsyncState";
import { useAsyncData } from "@/components/data/useAsyncData";
import { useMode } from "@/components/mode/ModeProvider";
import { activeChain } from "@/lib/chain-config";
import { formatCompactCurrency, formatCurrency, formatNumber, shortenAddress } from "@/lib/format";
import { getProjectBundle } from "@/lib/services";
import { ProjectNavigation } from "./ProjectNavigation";

export function TokenView({ slug }: { slug: string }) {
  const { mode } = useMode();
  const isLive = mode === "live";
  const { data: bundle, loading, error } = useAsyncData(() => getProjectBundle(slug), [slug]);
  if (loading) return <LoadingState label="Loading token information"/>;
  if (error) return <ErrorState message={error}/>;
  if (!bundle) return <ProjectNotFound slug={slug}/>;
  const { project } = bundle;
  const token = project.token;
  const isDeployed = isLive && Boolean(token.contract);
  const hasMarket = isDeployed && token.launchProvider === "pons";
  const explorerBase = activeChain.blockExplorers.default.url;

  const badge = !isLive
    ? <StatusBadge tone="green">Verified mock contract</StatusBadge>
    : isDeployed
      ? <StatusBadge tone="green">{token.launchProvider === "pons" ? "Launched on Pons" : "Deployed onchain"}</StatusBadge>
      : <StatusBadge tone="grey">Not launched yet</StatusBadge>;

  const marketNote = !isLive ? "Mock market data" : hasMarket ? "Live · from the Uniswap V3 pool" : isDeployed ? "No trading market for this launch type" : "Not launched yet";
  const holderNote = !isLive ? "Mock holder count" : isDeployed ? "Live holder count" : "Not launched yet";
  const liquidityNote = !isLive ? "Mock liquidity depth" : hasMarket ? "Real balances held by the pool" : isDeployed ? "No trading market for this launch type" : "Not launched yet";

  return <>
    <PageTitle eyebrow={`${project.name} · Token information`} title={`$${token.symbol}`} subtitle={token.name} action={badge}/>
    <ProjectNavigation slug={slug} active="token"/>
    <Panel className="token-disclosure"><strong>Public disclosure</strong><span>The project token does not represent legal ownership of the treasury or its assets.</span></Panel>
    <div className="metrics-grid"><MetricCard label="Token price" value={formatCurrency(token.price,4)} note={marketNote}/><MetricCard label="Market cap" value={formatCompactCurrency(token.marketCap)} note="Price × circulating supply"/><MetricCard label="Holders" value={formatNumber(token.holderCount)} note={holderNote}/><MetricCard label="Liquidity" value={formatCompactCurrency(token.liquidity)} note={liquidityNote}/></div>
    <div className="token-grid"><Panel><SectionHeader title="Supply and launch"/><div className="key-metrics"><div><span>Total supply</span><b>{formatNumber(token.totalSupply)}</b></div><div><span>Circulating supply</span><b>{formatNumber(token.circulatingSupply)}</b></div><div><span>Decimals</span><b>{token.decimals}</b></div><div><span>Deployment date</span><b>{token.deploymentDate || "—"}</b></div><div><span>Contract</span>{token.contract ? <a className="inline-link" href={`${explorerBase}/address/${token.contract}`} target="_blank" rel="noreferrer">{shortenAddress(token.contract)} ↗</a> : <span>—</span>}</div><div><span>Launch transaction</span>{token.launchTx ? <a className="inline-link" href={`${explorerBase}/tx/${token.launchTx}`} target="_blank" rel="noreferrer">{shortenAddress(token.launchTx)} ↗</a> : <span>—</span>}</div></div></Panel><Panel><SectionHeader title="Token distribution"/><DistributionBars items={token.distribution}/></Panel></div>
    <Panel><SectionHeader title="Token and treasury relationship"/><div className="relationship-grid"><div><span>Project token</span><strong>${token.symbol}</strong><p>Used by the project ecosystem according to its published token design.</p></div><div className="relationship-arrow">→</div><div><span>Public treasury</span><strong>{bundle.summary ? formatCurrency(bundle.summary.value) : "Not indexed yet"}</strong><p>Visible assets governed by a public policy and human-approved execution.</p></div></div></Panel>
  </>;
}
