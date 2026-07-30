"use client";

import { useMemo, useState } from "react";
import type { TreasuryAssetRule } from "@/lib/types";
import { formatCurrency } from "@/lib/format";
import { StatusBadge } from "./UI";

const categories = ["All", "Stablecoin", "Crypto", "Stock Token", "ETF Token"] as const;

type AssetCategory = (typeof categories)[number];

export function SupportedAssets({
  rules,
  onChange,
  readOnly = false,
  compact = false,
}: {
  rules: TreasuryAssetRule[];
  onChange?: (rules: TreasuryAssetRule[]) => void;
  readOnly?: boolean;
  compact?: boolean;
}) {
  const [category, setCategory] = useState<AssetCategory>("All");
  const visible = useMemo(
    () => rules.filter((rule) => category === "All" || rule.type === category),
    [rules, category],
  );
  const approvedCount = rules.filter((rule) => rule.approved).length;

  const updateRule = (symbol: string, patch: Partial<TreasuryAssetRule>) => {
    if (!onChange) return;
    onChange(rules.map((rule) => rule.symbol === symbol ? { ...rule, ...patch } : rule));
  };

  return <div className={`supported-assets ${compact ? "compact" : ""}`}>
    <div className="supported-assets-head">
      <div>
        <span className="mini-label">Treasury asset catalogue</span>
        <h3>Supported assets</h3>
        <p>Choose what the Treasury Agent may analyse and recommend. Every trade still requires a human wallet signature.</p>
      </div>
      <StatusBadge tone="green">{approvedCount} approved</StatusBadge>
    </div>
    <div className="asset-category-pills" role="tablist" aria-label="Asset categories">
      {categories.map((item) => <button type="button" key={item} className={item === category ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}
    </div>
    <div className="asset-rule-list">
      {visible.map((rule) => {
        const locked = rule.symbol === "USDG";
        return <article key={rule.symbol} className={rule.approved ? "asset-rule approved" : "asset-rule"}>
          <div className="asset-rule-identity">
            <span className="asset-icon">{rule.symbol.slice(0, 1)}</span>
            <div><strong>{rule.symbol}</strong><span>{rule.name} · {rule.type}</span></div>
          </div>
          {readOnly ? <>
            <div className="asset-rule-value"><span>Max allocation</span><b>{rule.approved ? `${rule.maxAllocation}%` : "—"}</b></div>
            <div className="asset-rule-value"><span>Max purchase</span><b>{rule.approved ? formatCurrency(rule.maxSinglePurchaseUsd, 0) : "—"}</b></div>
            <div className="asset-rule-value"><span>Agent</span><b>{rule.agentMayRecommend ? "May recommend" : "Blocked"}</b></div>
            <StatusBadge tone={rule.approved ? "green" : "grey"}>{rule.approved ? "Approved" : "Not approved"}</StatusBadge>
          </> : <>
            <label className="asset-approval-toggle"><input type="checkbox" checked={rule.approved} disabled={locked} onChange={(event) => updateRule(rule.symbol, { approved: event.target.checked, agentMayRecommend: event.target.checked && !locked })}/><span>{locked ? "Required reserve" : rule.approved ? "Approved" : "Approve"}</span></label>
            <label><span>Max allocation</span><div className="inline-number"><input type="number" min="0" max="100" value={rule.maxAllocation} disabled={!rule.approved || locked} onChange={(event) => updateRule(rule.symbol, { maxAllocation: Number(event.target.value) })}/><b>%</b></div></label>
            <label><span>Max purchase</span><div className="inline-number"><b>$</b><input type="number" min="0" step="250" value={rule.maxSinglePurchaseUsd} disabled={!rule.approved || locked} onChange={(event) => updateRule(rule.symbol, { maxSinglePurchaseUsd: Number(event.target.value) })}/></div></label>
            <label className="agent-permission"><input type="checkbox" checked={rule.agentMayRecommend} disabled={!rule.approved || locked} onChange={(event) => updateRule(rule.symbol, { agentMayRecommend: event.target.checked })}/><span>Agent may recommend</span></label>
          </>}
        </article>;
      })}
    </div>
    {!readOnly && <div className="asset-policy-note"><strong>Automatic execution remains off.</strong><span>Approving an asset only allows policy-validated recommendations. It does not let the Agent trade by itself.</span></div>}
  </div>;
}
