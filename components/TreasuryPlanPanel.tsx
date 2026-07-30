"use client";

import { useMemo, useState } from "react";
import { StatusBadge } from "./UI";
import { EmptyState, ErrorState, LoadingState } from "./data/AsyncState";
import { useAsyncData } from "./data/useAsyncData";
import { LiveSwapPanel } from "./trading/LiveSwapPanel";
import { generateTreasuryPlan, getTreasuryPlans, regenerateTreasuryPlan, requestMockTradeQuote, setPlanStepStatus, setTreasuryPlanPaused } from "@/lib/services";
import type { TradeQuote, TreasuryPlan } from "@/lib/types";
import { formatCurrency } from "@/lib/format";

// Treasury Plans sequence several recommendations behind one objective, but
// introduce no second policy authority: every step below is a normal,
// independently policy-evaluated recommendation underneath (see
// lib/server/db/treasury-plans.ts). This panel only adds ordering,
// conditions, stop rules and plan-level controls on top of that.
export function TreasuryPlanPanel({ slug, isLive, treasuryAddress }: { slug: string; isLive: boolean; treasuryAddress: string }) {
  const { data: plans, loading, error, reload } = useAsyncData(() => getTreasuryPlans(slug), [slug]);
  const [objective, setObjective] = useState("");
  const [generating, setGenerating] = useState(false);
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Mock-mode quote state, keyed by recommendation id — several steps can be
  // "Approved" at once, each with its own independent quote in flight.
  const [mockQuotes, setMockQuotes] = useState<Record<string, TradeQuote | null>>({});
  const [mockQuoteLoading, setMockQuoteLoading] = useState<Record<string, boolean>>({});

  const selected = useMemo<TreasuryPlan | null>(() => {
    if (!plans || plans.length === 0) return null;
    return plans.find((plan) => plan.id === selectedId) ?? plans[0];
  }, [plans, selectedId]);

  if (loading) return <LoadingState label="Loading treasury plans"/>;
  if (error) return <ErrorState message={error}/>;

  const runGenerate = async () => {
    if (!objective.trim() || generating) return;
    setGenerating(true);
    setActionError(null);
    try {
      const plan = await generateTreasuryPlan(slug, objective.trim());
      setSelectedId(plan.id);
      setObjective("");
      await reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Failed to generate treasury plan.");
    } finally {
      setGenerating(false);
    }
  };

  const togglePause = async (plan: TreasuryPlan) => {
    setBusyPlanId(plan.id);
    setActionError(null);
    try {
      await setTreasuryPlanPaused(slug, plan.id, plan.status !== "Paused");
      await reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Failed to update the plan.");
    } finally {
      setBusyPlanId(null);
    }
  };

  const runRegenerate = async (plan: TreasuryPlan) => {
    setBusyPlanId(plan.id);
    setActionError(null);
    try {
      const next = await regenerateTreasuryPlan(slug, plan.id);
      setSelectedId(next.id);
      await reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Failed to regenerate the plan.");
    } finally {
      setBusyPlanId(null);
    }
  };

  const decideStep = async (plan: TreasuryPlan, recommendationId: string, next: "approved" | "rejected") => {
    setActionError(null);
    try {
      await setPlanStepStatus(slug, plan.id, recommendationId, next);
      await reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Failed to update this step.");
    }
  };

  const requestStepMockQuote = async (rec: TreasuryPlan["steps"][number]["recommendation"]) => {
    setMockQuoteLoading((current) => ({ ...current, [rec.id]: true }));
    setMockQuotes((current) => ({ ...current, [rec.id]: null }));
    try {
      const quote = await requestMockTradeQuote(rec);
      setMockQuotes((current) => ({ ...current, [rec.id]: quote }));
    } finally {
      setMockQuoteLoading((current) => ({ ...current, [rec.id]: false }));
    }
  };

  const completedCount = (plan: TreasuryPlan) => plan.steps.filter((s) => s.recommendation.status === "Approved").length;
  const blockedCount = (plan: TreasuryPlan) => plan.steps.filter((s) => s.recommendation.policyResult === "Fail").length;
  const pendingCount = (plan: TreasuryPlan) => plan.steps.filter((s) => s.recommendation.status === "Pending" && s.recommendation.policyResult !== "Fail").length;

  return <div className="operator-layout">
    <section className="operator-list">
      <div className="operator-tool" style={{ marginBottom: 12 }}>
        <span className="mini-label">Treasury objective</span>
        <textarea
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
          placeholder="e.g. Build USDG reserve to 65% over the next month, then resume approved-asset accumulation."
          rows={3}
        />
        <button className="generate-review-button" type="button" onClick={runGenerate} disabled={generating || !objective.trim()}>
          <span>Generate treasury plan</span><b>{generating ? "Generating…" : isLive ? "AI Agent run ↗" : "Mock Agent run ↗"}</b>
        </button>
      </div>
      {actionError && <div className="form-error">{actionError}</div>}
      {!plans || plans.length === 0
        ? <EmptyState title="No treasury plans yet" body="State an objective above and generate the first staged plan."/>
        : plans.map((plan) => <button key={plan.id} className={selected?.id === plan.id ? "operator-item active" : "operator-item"} onClick={() => setSelectedId(plan.id)}>
            <div><b>{plan.objective}</b><span>{plan.steps.length} step{plan.steps.length === 1 ? "" : "s"} · {plan.createdAt}</span></div>
            <StatusBadge tone={plan.status === "Active" ? "lime" : plan.status === "Paused" ? "red" : plan.status === "Completed" ? "green" : "red"}>{plan.status}</StatusBadge>
          </button>)}
    </section>
    <section className="quote-card">
      {selected ? <>
        <span className="mini-label">Plan review</span>
        <h2>{selected.objective}</h2>
        <div className="system-status" style={{ marginBottom: 16 }}>
          <div><span>Completed</span><b>{completedCount(selected)}</b></div>
          <div><span>Blocked</span><b>{blockedCount(selected)}</b></div>
          <div><span>Pending</span><b>{pendingCount(selected)}</b></div>
          <div><span>Review cadence</span><b style={{ textTransform: "capitalize" }}>{selected.reviewCadence}</b></div>
        </div>
        <div className="card-actions" style={{ marginBottom: 16 }}>
          <button
            className="secondary-button"
            disabled={busyPlanId === selected.id || selected.status === "Completed" || selected.status === "Cancelled"}
            onClick={() => togglePause(selected)}
          >
            {busyPlanId === selected.id ? "Working…" : selected.status === "Paused" ? "Resume plan" : "Pause plan"}
          </button>
          <button
            className="primary-button"
            disabled={busyPlanId === selected.id || selected.status === "Completed"}
            onClick={() => runRegenerate(selected)}
          >
            {busyPlanId === selected.id ? "Working…" : "Regenerate plan"}
          </button>
        </div>
        {selected.steps.map((step, index) => {
          const rec = step.recommendation;
          const blocked = rec.policyResult === "Fail";
          const isHold = rec.action === "HOLD";
          const tradable = !isHold && rec.status === "Approved";
          const quote = mockQuotes[rec.id] ?? null;
          const previousStep = index > 0 ? selected.steps[index - 1] : null;
          // The condition text describes an order the Agent intends — this is
          // what actually enforces it: you can't decide step N until step N-1
          // has been decided (approved or rejected), not just proposed.
          const waitingOnPriorStep = Boolean(previousStep && previousStep.recommendation.status === "Pending");
          return <div key={step.id} className="policy-result compact" style={{ marginBottom: 10, alignItems: "flex-start" }}>
            <div className="check-icon">{blocked ? "!" : rec.status === "Approved" ? "✓" : "•"}</div>
            <div style={{ flex: 1 }}>
              <strong>Step {step.order + 1} · {rec.title}</strong>
              <p>{rec.rationale}</p>
              <p><em>{step.condition}</em></p>
              {step.stopRule && <p>Stop rule: {step.stopRule}</p>}
              <div className="trade-route"><div><span>Amount</span><strong>{rec.amount}</strong></div><div><span>Policy</span><strong>{rec.policyResult}</strong></div><div><span>Status</span><strong>{rec.status}</strong></div></div>
              {rec.policyChecks.length > 0 && <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.7, margin: "8px 0", opacity: 0.9 }}>
                {rec.policyChecks.map((check) => <div key={check.name} style={{ display: "flex", gap: 8 }}>
                  <span>{check.passed ? "✓" : "✗"}</span>
                  <span className="mono" style={{ minWidth: 200 }}>{check.name}</span>
                  <span style={{ opacity: 0.75 }}>{check.reason}</span>
                </div>)}
              </div>}
              {!blocked && rec.status === "Pending" && (waitingOnPriorStep ? (
                <div className="quote-placeholder">Waiting on step {index} to be resolved first.</div>
              ) : <div className="card-actions">
                <button className="secondary-button danger-button" onClick={() => decideStep(selected, rec.id, "rejected")}>Reject</button>
                <button className="primary-button" onClick={() => decideStep(selected, rec.id, "approved")}>Approve step</button>
              </div>)}
              {tradable && (isLive ? (
                <LiveSwapPanel slug={slug} recommendation={rec} treasuryAddress={treasuryAddress} onExecuted={() => void reload()}/>
              ) : (
                <div className="quote-request-row">
                  <button className="secondary-button" onClick={() => void requestStepMockQuote(rec)} disabled={mockQuoteLoading[rec.id]}>
                    {mockQuoteLoading[rec.id] ? "Requesting quote…" : quote ? "Refresh mock quote" : "Request mock quote"}
                  </button>
                  {quote && <div className="quote-details">
                    <div><span>Expected output</span><b>{quote.expectedOutput}</b></div>
                    <div><span>Price impact</span><b>{quote.priceImpact.toFixed(2)}%</b></div>
                    <div><span>Estimated fees</span><b>{formatCurrency(quote.feesUsd)}</b></div>
                    <div><span>Network</span><b>{quote.network}</b></div>
                  </div>}
                </div>
              ))}
            </div>
          </div>;
        })}
      </> : <EmptyState title="No plan selected" body="Generate a treasury plan to see its staged steps here."/>}
    </section>
  </div>;
}
