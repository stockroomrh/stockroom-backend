"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { PageTitle } from "@/components/PageTitle";
import { MetricCard, Panel, SectionHeader, StatusBadge } from "@/components/UI";
import { ProjectMark } from "@/components/ProjectMark";
import { ErrorState, LoadingState, ProjectNotFound } from "@/components/data/AsyncState";
import { useAsyncData } from "@/components/data/useAsyncData";
import { formatCurrency } from "@/lib/format";
import { getProjectBundle } from "@/lib/services";
import { useMode } from "@/components/mode/ModeProvider";
import { activeChainId } from "@/lib/chain-config";
import { PONS_LAUNCH_LOCKER_ABI } from "@/lib/contracts/pons-launch-locker";

const tabs = [
  ["Overview", ""],
  ["Token", "/public/token"],
  ["Treasury", "/public/treasury"],
  ["Agent", "/public/agent"],
  ["Activity", "/public/activity"],
  ["Policy", "/public/policy"],
  ["Operators", "/operator"],
  ["Settings", "/settings"],
] as const;

export function ProjectManagementView({ slug }: { slug: string }) {
  const { mode } = useMode();
  const { address: connectedAddress, chainId: connectedChainId } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const { data: bundle, loading, error, reload } = useAsyncData(() => getProjectBundle(slug), [slug]);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimMessage, setClaimMessage] = useState<string | null>(null);

  const resync = async () => {
    setSyncing(true);
    setSyncError(null);
    setSyncMessage(null);
    try {
      const response = await fetch(`/api/projects/${slug}/sync`, { method: "POST" });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error((body as { error?: string } | null)?.error ?? `Sync failed (${response.status})`);
      }
      const positionCount = body?.positions?.length ?? 0;
      const totalValue = body?.summary?.value;
      setSyncMessage(
        positionCount > 0
          ? `Synced — ${positionCount} position${positionCount === 1 ? "" : "s"} found, total value ${totalValue !== undefined ? formatCurrency(totalValue) : "$0"}.`
          : "Synced — no balances found at this treasury address yet (it may be empty, or its assets aren't approved for this project).",
      );
      await reload();
    } catch (cause) {
      setSyncError(cause instanceof Error ? cause.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  };

  // Pons's locked LP position accrues trading fees but never auto-pushes
  // them — the treasury wallet (authorised as both the launch deployer and
  // the fee-redirect recipient) has to call collectFees() itself to pull
  // them in. Same signed-transaction pattern as everywhere else: the
  // operator signs, this app never holds a key.
  const claimFees = async (tokenContract: string) => {
    if (!connectedAddress || !publicClient) {
      setClaimError("Connect your wallet to claim trading fees.");
      return;
    }
    setClaiming(true);
    setClaimError(null);
    setClaimMessage(null);
    try {
      if (connectedChainId !== activeChainId) {
        await switchChainAsync({ chainId: activeChainId });
      }
      const configResponse = await fetch(`/api/projects/${slug}/pons-launch-config`);
      const configBody = await configResponse.json().catch(() => null);
      if (!configResponse.ok) throw new Error(configBody?.error ?? "Failed to resolve the fee locker.");

      const hash = await writeContractAsync({
        chainId: activeChainId,
        address: configBody.lockerAddress,
        abi: PONS_LAUNCH_LOCKER_ABI,
        functionName: "collectFees",
        args: [tokenContract as `0x${string}`],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The claim transaction reverted onchain.");
      setClaimMessage("Fees claimed — resyncing treasury…");
      await resync();
    } catch (cause) {
      setClaimError(cause instanceof Error ? cause.message : "Failed to claim trading fees.");
    } finally {
      setClaiming(false);
    }
  };

  if (loading) return <LoadingState label="Loading private project workspace"/>;
  if (error) return <ErrorState message={error}/>;
  if (!bundle) return <ProjectNotFound slug={slug}/>;
  const { project, summary, recommendations, activity } = bundle;
  return <>
    <PageTitle eyebrow="Private project workspace" title={project.name} subtitle={`Manage $${project.ticker}, its treasury and authorised operations.`} action={<ProjectMark project={project} size="large"/>}/>
    <nav className="management-tabs">{tabs.map(([tab, path]) => {
      const href = path.startsWith("/public/") ? `/app/project/${slug}/${path.replace("/public/", "")}` : `/app/dashboard/projects/${slug}${path}`;
      return <Link key={tab} href={href} className={tab === "Overview" ? "active" : ""}>{tab}</Link>;
    })}</nav>
    <Panel className="auth-strip"><div><span className="auth-dot"/><div><strong>Owner permissions active</strong><span>{mode === "live" ? "Wallet-authenticated route — server verifies your role on every request." : "Production authentication and wallet permissions are not connected yet."}</span></div></div><StatusBadge tone="green">{mode === "live" ? "Live protected route" : "Mock protected route"}</StatusBadge></Panel>
    <div className="metrics-grid"><MetricCard label="Treasury NAV" value={summary ? formatCurrency(summary.value) : "—"} note={summary ? `${summary.change30d>=0?"+":""}${summary.change30d}% over 30D` : "Not indexed yet"} positive={summary ? summary.change30d>=0 : undefined}/><MetricCard label="Reserve status" value={summary ? `${summary.reserve}%` : "—"} note={summary ? `Target ${summary.reserveTarget}%` : "Not indexed yet"}/><MetricCard label="Pending proposals" value={`${recommendations.filter((item)=>item.status==="Pending").length}`} note="Requires operator review"/><MetricCard label="System state" value="LIVE" note={mode === "live" ? "Live onchain data" : "Frontend simulation"} positive/></div>
    <div className="management-grid"><Panel><SectionHeader title="Operator actions"/><div className="action-stack">{mode === "live" && <button className="primary-button" type="button" onClick={resync} disabled={syncing}>{syncing ? "Syncing treasury…" : "Resync treasury from chain"}</button>}{syncError && <div className="form-error">{syncError}</div>}{syncMessage && !syncError && <div className="sync-success">{syncMessage}</div>}{summary && mode === "live" && <small className="muted">Last synced {summary.updated}</small>}{mode === "live" && project.token.launchProvider === "pons" && project.token.contract && <button className="secondary-button" type="button" onClick={()=>void claimFees(project.token.contract)} disabled={claiming}>{claiming ? "Claiming fees…" : "Claim trading fees"}</button>}{claimError && <div className="form-error">{claimError}</div>}{claimMessage && !claimError && <div className="sync-success">{claimMessage}</div>}<Link className="secondary-button" href={`/app/dashboard/projects/${slug}/operator`}>Open operator console</Link><Link className="secondary-button" href={`/app/project/${slug}`}>View public project</Link><Link className="secondary-button" href={`/app/project/${slug}/policy`}>Review active policy</Link></div></Panel><Panel><SectionHeader title="Pending recommendations"/><div className="compact-recommendations">{recommendations.filter((item)=>item.status==="Pending").map((item)=><div key={item.id}><div><strong>{item.title}</strong><span>{item.rationale}</span></div><b>{item.amount}</b></div>)}</div></Panel><Panel><SectionHeader title="Latest activity"/><div className="compact-recommendations">{activity.slice(0,4).map((item)=><div key={item.id}><div><strong>{item.description}</strong><span>{item.type} · {item.time}</span></div><b>{item.usdValue}</b></div>)}</div></Panel></div>
    <Panel><SectionHeader title="Project configuration"/><div className="settings-preview"><div><span>Public profile</span><b>Published</b><button className="secondary-button">Edit profile</button></div><div><span>Operator wallets</span><b>1 authorised</b><button className="secondary-button">Manage</button></div><div><span>Treasury policy</span><b>Version {bundle.policy.version}</b><button className="secondary-button">Propose update</button></div><div><span>Trading</span><b>Human approval required</b><button className="secondary-button">Controls</button></div></div></Panel>
  </>;
}
