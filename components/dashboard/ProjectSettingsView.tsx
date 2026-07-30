"use client";

import Link from "next/link";
import { useState } from "react";
import { PageTitle } from "@/components/PageTitle";
import { Panel, SectionHeader, StatusBadge } from "@/components/UI";
import { ProjectMark } from "@/components/ProjectMark";
import { SupportedAssets } from "@/components/SupportedAssets";
import { ErrorState, LoadingState, ProjectNotFound } from "@/components/data/AsyncState";
import { useAsyncData } from "@/components/data/useAsyncData";
import { useMode } from "@/components/mode/ModeProvider";
import { getProjectBundle, updateProjectAssetRules } from "@/lib/services";
import type { ProjectBundle, TreasuryAssetRule } from "@/lib/types";

export function ProjectSettingsView({ slug }: { slug: string }) {
  const { data: bundle, loading, error } = useAsyncData(() => getProjectBundle(slug), [slug]);
  if (loading) return <LoadingState label="Loading project settings"/>;
  if (error) return <ErrorState message={error}/>;
  if (!bundle) return <ProjectNotFound slug={slug}/>;
  return <ProjectSettingsContent bundle={bundle}/>;
}

function ProjectSettingsContent({ bundle }: { bundle: ProjectBundle }) {
  const { mode } = useMode();
  const isLive = mode === "live";
  const { project, policy } = bundle;
  const [assetRules, setAssetRules] = useState<TreasuryAssetRule[]>(policy.assetRules);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const saveAssets = async () => {
    setSaving(true);
    setSaved(false);
    await updateProjectAssetRules(project.slug, assetRules);
    setSaving(false);
    setSaved(true);
  };

  return <>
    <PageTitle eyebrow="Private configuration" title="SETTINGS" subtitle={isLive ? `Manage live configuration for ${project.name}.` : `Manage the mocked frontend configuration for ${project.name}.`} action={<ProjectMark project={project}/>}/>
    <div className="settings-header-links"><Link href={`/app/dashboard/projects/${project.slug}`}>← Project dashboard</Link><StatusBadge tone="green">{isLive ? "Live owner access" : "Mock owner access"}</StatusBadge></div>
    <div className="settings-page-grid">
      <Panel><SectionHeader title="Public project profile"/><div className="form-grid"><label>Project name<input defaultValue={project.name} disabled={isLive}/></label><label>Ticker<input defaultValue={project.ticker} disabled={isLive}/></label><label className="full">Description<textarea defaultValue={project.description} disabled={isLive}/></label><label>Website<input defaultValue={project.socials.website} disabled={isLive}/></label><label>X / Twitter<input defaultValue={project.socials.x} disabled={isLive}/></label></div><div className="settings-actions">{isLive ? <small className="muted">Editing the public profile after launch isn&apos;t available yet.</small> : <button className="primary-button">Save mock profile</button>}</div></Panel>
      <Panel><SectionHeader title="Operator wallets"/><div className="operator-wallet-card"><div><strong>Primary operator</strong><span>{project.creatorWallet}</span></div><StatusBadge tone="green">Owner</StatusBadge></div>{isLive ? <div className="policy-lock-note"><strong>Adding additional operators isn&apos;t available yet.</strong><p>Only the project owner's wallet can operate this treasury right now.</p></div> : <><button className="secondary-button">Add mock operator</button><div className="policy-lock-note"><strong>Production permissions are not connected.</strong><p>Real operator management will require authenticated wallets and onchain or multisig permissions.</p></div></>}</Panel>
      <Panel className="settings-assets-panel"><SectionHeader title="Supported assets" action={saved?<StatusBadge tone="green">{isLive ? "Saved" : "Saved locally"}</StatusBadge>:undefined}/><SupportedAssets rules={assetRules} onChange={(rules)=>{setAssetRules(rules);setSaved(false)}}/><div className="settings-actions"><button className="primary-button" onClick={saveAssets} disabled={saving}>{saving?"Saving…":"Save asset policy"}</button></div></Panel>
      <Panel><SectionHeader title="Treasury controls"/><div className="key-metrics"><div><span>Policy version</span><b>{policy.version}</b></div><div><span>Human approval</span><StatusBadge tone="green">Required</StatusBadge></div><div><span>Automated execution</span><StatusBadge tone="grey">Disabled</StatusBadge></div><div><span>Trading status</span><StatusBadge tone="green">Active</StatusBadge></div></div><Link className="secondary-button" href={`/app/project/${project.slug}/policy`}>Open public policy</Link></Panel>
      <Panel><SectionHeader title="Notifications"/><div className="toggle-list"><label><input type="checkbox" defaultChecked/><span>Reserve threshold alerts</span></label><label><input type="checkbox" defaultChecked/><span>New Agent recommendations</span></label><label><input type="checkbox" defaultChecked/><span>Trade execution updates</span></label><label><input type="checkbox"/><span>Daily treasury summaries</span></label></div></Panel>
    </div>
    <Panel className="danger-zone"><SectionHeader title="Danger zone"/><p>{isLive ? "Pausing trading and archiving aren't available yet — they don't change anything below." : "These controls are visual placeholders. They do not change contracts, wallets or live project data."}</p><div><button className="secondary-button danger-button" disabled={isLive}>Pause public trading</button><button className="secondary-button danger-button" disabled={isLive}>{isLive ? "Archive project" : "Archive mock project"}</button></div></Panel>
  </>;
}
