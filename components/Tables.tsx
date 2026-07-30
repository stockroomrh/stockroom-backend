import Link from "next/link";
import type { ActivityItem, TreasuryPosition } from "@/lib/types";
import { StatusBadge } from "./UI";
import { shortenAddress } from "@/lib/format";

export function HoldingsTable({ positions, compact = false, projectSlug = "stockroom" }: { positions: TreasuryPosition[]; compact?: boolean; projectSlug?: string }) {
  return (
    <div className="table-wrap">
      <table className={`data-table ${compact ? "compact" : ""}`}>
        <thead><tr><th>Asset</th><th>Type</th><th>Balance</th><th>Price</th><th>Value</th><th>Allocation</th><th>24h</th>{!compact && <><th>Contract</th><th>Freshness</th></>}</tr></thead>
        <tbody>{positions.map((position) => (
          <tr key={position.symbol}>
            <td><Link href={`/app/project/${projectSlug}/assets/${encodeURIComponent(position.symbol)}`} className="asset-cell"><span className="asset-icon">{position.symbol.slice(0, 1)}</span><div><b>{position.symbol}</b><small>{position.name}</small></div></Link></td>
            <td>{position.type}</td><td>{position.balance}</td><td>${position.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td><td>${position.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td><td>{position.allocation}%</td>
            <td className={position.change24h >= 0 ? "positive" : "negative"}>{position.change24h >= 0 ? "+" : ""}{position.change24h}%</td>
            {!compact && <><td><a className="inline-link" href={position.contractUrl} target="_blank" rel="noreferrer">{shortenAddress(position.contract)}</a></td><td><StatusBadge tone={position.freshness === "Live" ? "green" : position.freshness === "Delayed" ? "lime" : "red"}>{position.freshness}</StatusBadge></td></>}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export function ActivityTable({ items }: { items: ActivityItem[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table activity-table">
        <thead><tr><th>Time</th><th>Type</th><th>Description</th><th>Asset</th><th>Amount</th><th>USD value</th><th>Status</th><th>Explorer</th></tr></thead>
        <tbody>{items.map((item) => (
          <tr key={item.id}>
            <td>{item.time}</td><td><b>{item.type}</b></td><td>{item.description}</td><td>{item.asset}</td><td>{item.amount}</td><td>{item.usdValue}</td>
            <td><StatusBadge tone={item.status === "Confirmed" ? "green" : item.status === "Needs review" ? "lime" : "grey"}>{item.status}</StatusBadge></td>
            <td><a className="inline-link" href={item.blockscoutUrl} target="_blank" rel="noreferrer">Blockscout ↗</a></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
