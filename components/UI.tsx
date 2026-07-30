import type { ReactNode } from "react";

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{children}</section>;
}

export function MetricCard({ label, value, note, positive }: { label: string; value: string; note?: string; positive?: boolean }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small className={positive ? "positive" : ""}>{note}</small>}
    </article>
  );
}

export function StatusBadge({ children, tone = "lime" }: { children: ReactNode; tone?: "lime" | "green" | "red" | "grey" }) {
  return <span className={`status-badge ${tone}`}>{children}</span>;
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return <div className="section-header"><h2>{title}</h2>{action}</div>;
}
