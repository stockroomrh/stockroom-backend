"use client";

import { useEffect, useMemo, useState } from "react";
import { StatusBadge } from "./UI";
import { SupportedAssets } from "./SupportedAssets";
import { EmptyState, ErrorState, LoadingState, ProjectNotFound } from "./data/AsyncState";
import { useAsyncData } from "./data/useAsyncData";
import { useMode } from "./mode/ModeProvider";
import { LiveSwapPanel } from "./trading/LiveSwapPanel";
import { TreasuryPlanPanel } from "./TreasuryPlanPanel";
import { generateAgentReport, getProjectBundle, requestMockTradeQuote, setRecommendationStatus, updateProjectAssetRules } from "@/lib/services";
import type { ProjectBundle, ProposalStatus, Recommendation, TradeQuote, TreasuryAssetRule } from "@/lib/types";
import { formatCurrency } from "@/lib/format";

export function OperatorConsole({ slug }: { slug: string }) {
  const { mode } = useMode();
  const isLive = mode === "live";
  const { data: bundle, loading, error } = useAsyncData(() => getProjectBundle(slug), [slug]);
  // Live actions (generate / approve / reject) write straight to the DB and
  // hand back fresh data; this override lets the console reflect that
  // immediately without waiting on useAsyncData's own refetch triggers.
  const [liveBundle, setLiveBundle] = useState<ProjectBundle | null>(null);
  const effectiveBundle = liveBundle ?? bundle;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [localStatuses, setLocalStatuses] = useState<Record<string, ProposalStatus>>({});
  const [amount, setAmount] = useState(0);
  const [quote, setQuote] = useState<TradeQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [tradingPaused, setTradingPaused] = useState(false);
  const [assetRules, setAssetRules] = useState<TreasuryAssetRule[]>([]);
  const [assetSaving, setAssetSaving] = useState(false);
  const [assetSaved, setAssetSaved] = useState(false);
  const [classification, setClassification] = useState("Revenue");
  const [generating, setGenerating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"recommendations" | "plans">("recommendations");

  useEffect(() => setLiveBundle(null), [bundle]);

  const selected = useMemo(() => effectiveBundle?.recommendations.find((item) => item.id === selectedId) ?? effectiveBundle?.recommendations[0] ?? null, [effectiveBundle, selectedId]);
  const status = selected ? localStatuses[selected.id] ?? selected.status : "Pending";

  useEffect(() => {
    if (selected) {
      setAmount(selected.amountUsd);
      setQuote(null);
    }
  }, [selected?.id]);

  useEffect(() => {
    if (effectiveBundle) setAssetRules(effectiveBundle.policy.assetRules);
  }, [effectiveBundle]);

  if (loading) return <LoadingState label="Loading operator controls"/>;
  if (error) return <ErrorState message={error}/>;
  if (!effectiveBundle) return <ProjectNotFound slug={slug}/>;
  const bundleForRender = effectiveBundle;

  const operatorTabs = <div className="operator-tabs">
    <button className={activeTab === "recommendations" ? "active" : ""} onClick={() => setActiveTab("recommendations")}>Recommendations</button>
    <button className={activeTab === "plans" ? "active" : ""} onClick={() => setActiveTab("plans")}>Plans</button>
    <button>Quotes</button><button>Transactions</button>
  </div>;

  if (activeTab === "plans") {
    return <div className="operator-workspace">
      <div className="operator-auth-banner"><div><span className="auth-dot"/><div><strong>Authorised operator session</strong><span>{isLive ? "Live session · no wallet or transaction connection yet" : "Mock authentication · no wallet or transaction connection"}</span></div></div></div>
      {operatorTabs}
      <TreasuryPlanPanel slug={slug} isLive={isLive} treasuryAddress={bundleForRender.project.treasuryAddress}/>
    </div>;
  }

  const generateReview = async () => {
    if (!isLive || generating) return;
    setGenerating(true);
    setActionError(null);
    try {
      const updated = await generateAgentReport(slug);
      if (updated) setLiveBundle(updated);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Failed to generate treasury review.");
    } finally {
      setGenerating(false);
    }
  };

  const generateReviewButton = <button className="generate-review-button" type="button" onClick={isLive ? generateReview : undefined} disabled={isLive && generating}><span>Generate treasury review</span><b>{isLive ? (generating ? "Generating…" : "AI Agent run ↗") : "Mock Agent run ↗"}</b></button>;

  // A project with no recommendations yet is normal in Live mode — the
  // treasury may simply not have had its first Agent report generated. This
  // is not the same as the project itself not existing.
  if (!selected) {
    return <div className="operator-workspace">
      <div className="operator-auth-banner"><div><span className="auth-dot"/><div><strong>Authorised operator session</strong><span>{isLive ? "Live session · no wallet or transaction connection yet" : "Mock authentication · no wallet or transaction connection"}</span></div></div></div>
      {actionError && <div className="form-error">{actionError}</div>}
      <section className="operator-list">
        {operatorTabs}
        {generateReviewButton}
        <EmptyState title="No recommendations yet" body={isLive ? "Generate the first treasury review to have the Agent propose recommendations." : "This project has no recommendations yet."}/>
        <div className="system-status"><h3>System health</h3>{[["Oracle feeds","Healthy"],["Price updates","Live"],["Chain connection","Mocked"],["Agent service","Ready"]].map(([label,value])=><div key={label}><span>{label}</span><b>{value}</b></div>)}</div>
      </section>
    </div>;
  }

  // A HOLD recommendation has no real target asset (fromAsset/toAsset are
  // just "—" placeholders) — it must never enter the buy/sell policy-gate
  // logic below, which was misreading "—" as an unapproved asset symbol and
  // showing a bogus "Policy action required" prompt for a no-op review.
  const isHold = selected.action === "HOLD";
  const targetRule = assetRules.find((rule) => rule.symbol.toLowerCase() === selected.toAsset.toLowerCase());
  const requiresAssetApproval = !isHold && selected.toAsset !== "USDG" && !targetRule?.approved;
  const recommendationBlocked = !isHold && selected.toAsset !== "USDG" && (!targetRule?.approved || !targetRule.agentMayRecommend);
  const amountExceedsAssetLimit = !isHold && Boolean(targetRule?.approved && targetRule.maxSinglePurchaseUsd > 0 && amount > targetRule.maxSinglePurchaseUsd);
  const policyBlocked = requiresAssetApproval || recommendationBlocked || amountExceedsAssetLimit;

  const recommendationWithAmount: Recommendation = { ...selected, amountUsd: amount, amount: formatCurrency(amount) };
  const updateStatus = (next: ProposalStatus) => setLocalStatuses((current) => ({ ...current, [selected.id]: next }));
  const decideRecommendation = async (next: "Approved" | "Rejected") => {
    if (isLive) {
      setActionError(null);
      try {
        const result = await setRecommendationStatus(slug, selected.id, next === "Approved" ? "approved" : "rejected");
        if (result) {
          setLiveBundle({ ...bundleForRender, recommendations: bundleForRender.recommendations.map((item) => (item.id === result.id ? result : item)) });
        }
      } catch (cause) {
        setActionError(cause instanceof Error ? cause.message : "Failed to update recommendation.");
      }
      return;
    }
    updateStatus(next);
  };
  const requestQuote = async () => {
    if (isLive || policyBlocked || tradingPaused) return;
    setQuoteLoading(true);
    setQuote(null);
    const nextQuote = await requestMockTradeQuote(recommendationWithAmount);
    setQuote(nextQuote);
    setQuoteLoading(false);
  };
  const saveAssetPolicy = async () => {
    setAssetSaving(true);
    setAssetSaved(false);
    await updateProjectAssetRules(slug, assetRules);
    setAssetSaving(false);
    setAssetSaved(true);
  };

  return <div className="operator-workspace">
    <div className="operator-auth-banner"><div><span className="auth-dot"/><div><strong>Authorised operator session</strong><span>{isLive ? "Live session · no wallet or transaction connection yet" : "Mock authentication · no wallet or transaction connection"}</span></div></div><StatusBadge tone={tradingPaused?"red":"green"}>{tradingPaused?"Trading paused":"System ready"}</StatusBadge></div>
    {actionError && <div className="form-error">{actionError}</div>}
    <div className="operator-layout">
      <section className="operator-list">
        {operatorTabs}
        {generateReviewButton}
        {bundleForRender.recommendations.map((recommendation) => {
          const itemStatus = localStatuses[recommendation.id] ?? recommendation.status;
          return <button key={recommendation.id} className={selected.id===recommendation.id?"operator-item active":"operator-item"} onClick={()=>setSelectedId(recommendation.id)}><div><b>{recommendation.title}</b><span>{recommendation.amount} · {recommendation.createdAt}</span>{recommendation.planObjective && <span className="mini-label">Part of plan: {recommendation.planObjective}</span>}</div><StatusBadge tone={itemStatus==="Approved"?"green":itemStatus==="Rejected"?"red":"lime"}>{itemStatus}</StatusBadge></button>;
        })}
        <div className="system-status"><h3>System health</h3>{[["Oracle feeds","Healthy"],["Price updates","Live"],["Chain connection","Mocked"],["Agent service","Ready"]].map(([label,value])=><div key={label}><span>{label}</span><b>{value}</b></div>)}</div>
      </section>
      <section className="quote-card">
        <span className="mini-label">Recommendation review</span><h2>{selected.title}</h2>{selected.planObjective && <StatusBadge tone="lime">Part of plan: {selected.planObjective}</StatusBadge>}<p>{selected.rationale}</p>
        {isLive
          ? <div className="editable-amount"><span>Proposed amount</span><div><b>$</b><span>{amount.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div><small>Set by the Agent's recommendation — not editable in Live mode.</small></div>
          : <label className="editable-amount"><span>Proposed amount</span><div><b>$</b><input type="number" min="0" value={amount} onChange={(event)=>{setAmount(Number(event.target.value));setQuote(null)}}/></div><small>Edit the amount before requesting a quote.</small></label>}
        {!isHold && <div className="trade-route"><div><span>From</span><strong>{selected.fromAsset}</strong></div><i>→</i><div><span>To</span><strong>{selected.toAsset}</strong></div></div>}
        {isHold
          ? <div className="policy-result compact"><div className="check-icon">✓</div><div><strong>No action required</strong><p>The Agent recommended holding — there is no trade to approve or execute for this review.</p></div></div>
          : policyBlocked ? <div className="policy-result compact blocked"><div className="check-icon">!</div><div><strong>Policy action required</strong><p>{requiresAssetApproval ? `${selected.toAsset} is not an approved treasury asset. Approve it below before requesting a quote.` : recommendationBlocked ? `The Agent is not permitted to recommend ${selected.toAsset}. Enable that permission below.` : `The amount exceeds the ${formatCurrency(targetRule?.maxSinglePurchaseUsd ?? 0, 0)} single-purchase limit.`}</p></div></div> : <div className="policy-result compact"><div className="check-icon">✓</div><div><strong>Policy validation passed</strong><p>Every trade still requires an authorised human wallet signature.</p></div></div>}
        {isHold ? <div className="quote-placeholder">This is a Hold recommendation — no trade to quote or execute.</div> : isLive ? (
          policyBlocked ? <div className="quote-placeholder">Resolve the policy issue above before requesting a live quote.</div> : <LiveSwapPanel slug={slug} recommendation={selected} treasuryAddress={bundleForRender.project.treasuryAddress} onExecuted={(updated)=>setLiveBundle(updated)}/>
        ) : <>
          <div className="quote-request-row"><button className="secondary-button" onClick={requestQuote} disabled={quoteLoading || tradingPaused || policyBlocked}>{quoteLoading?"Requesting quote…":"Request mock quote"}</button>{quote && <StatusBadge tone="green">Quote ready · {quote.expiresAt}</StatusBadge>}</div>
          {quote ? <div className="quote-details"><div><span>Expected output</span><b>{quote.expectedOutput}</b></div><div><span>Price impact</span><b>{quote.priceImpact.toFixed(2)}%</b></div><div><span>Estimated fees</span><b>{formatCurrency(quote.feesUsd)}</b></div><div><span>Network</span><b>{quote.network}</b></div></div> : <div className="quote-placeholder">Request a quote to display expected output, price impact and fees.</div>}
        </>}
        <div className="card-actions"><button className="secondary-button danger-button" onClick={()=>void decideRecommendation("Rejected")} disabled={status==="Rejected"}>Reject</button><button className="secondary-button" onClick={()=>updateStatus("Pending")} disabled={isLive}>Return to pending</button><button className="primary-button" onClick={()=>void decideRecommendation("Approved")} disabled={tradingPaused || policyBlocked || status==="Approved"}>Approve proposal</button></div>
        <div className="signature-box"><span>{isLive ? "Wallet signature" : "Wallet signature placeholder"}</span><b>{status === "Approved" ? "Ready for authorised wallet signature" : `Proposal ${status.toLowerCase()}`}</b></div>
      </section>
    </div>
    <div className="operator-tools-grid">
      <section className="operator-tool"><div><span className="mini-label">Transaction classification</span><h3>Classify an incoming transfer</h3></div><select value={classification} onChange={(event)=>setClassification(event.target.value)}><option>Revenue</option><option>Deposit</option><option>Expense reimbursement</option><option>Unclassified</option></select><button className="secondary-button">Save mock classification</button></section>
      <section className="operator-tool asset-management-tool"><div className="operator-tool-heading"><div><span className="mini-label">Supported assets</span><h3>Approved asset management</h3></div>{assetSaved&&<StatusBadge tone="green">Saved</StatusBadge>}</div><SupportedAssets rules={assetRules} onChange={(rules)=>{setAssetRules(rules);setAssetSaved(false)}} compact/><button className="primary-button" onClick={saveAssetPolicy} disabled={assetSaving}>{assetSaving?"Saving policy…":"Save asset policy"}</button></section>
      <section className="operator-tool pause-tool"><div><span className="mini-label">Emergency control</span><h3>Trading pause</h3><p>Pausing blocks new quote and approval actions in this frontend simulation.</p></div><button className={tradingPaused?"primary-button":"secondary-button danger-button"} onClick={()=>setTradingPaused((value)=>!value)}>{tradingPaused?"Resume trading":"Pause trading"}</button></section>
    </div>
  </div>;
}
