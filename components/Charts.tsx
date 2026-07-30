import type { TreasuryPosition, TreasurySnapshot } from "@/lib/types";

export function LineChart({ values, compact = false }: { values: number[] | TreasurySnapshot[]; compact?: boolean }) {
  const numericValues = values.map((value) => typeof value === "number" ? value : value.value);
  const width = 720;
  const height = compact ? 190 : 250;
  const padding = 22;
  const min = Math.min(...numericValues);
  const max = Math.max(...numericValues);
  const points = numericValues.map((value, index) => {
    const x = padding + (index / Math.max(1, numericValues.length - 1)) * (width - padding * 2);
    const y = height - padding - ((value - min) / (max - min || 1)) * (height - padding * 2);
    return `${x},${y}`;
  }).join(" ");
  const lastPoint = points.split(" ").at(-1)?.split(",") ?? [width - padding, height - padding];
  const area = `${padding},${height - padding} ${points} ${width - padding},${height - padding}`;
  return (
    <svg className="line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Treasury value chart">
      {[0.25, 0.5, 0.75].map((number) => <line key={number} x1={padding} y1={height * number} x2={width - padding} y2={height * number} className="grid-line" />)}
      <polygon points={area} className="chart-area" />
      <polyline points={points} className="chart-line" />
      <circle cx={lastPoint[0]} cy={lastPoint[1]} r="7" className="chart-dot" />
    </svg>
  );
}

const allocationColors = ["var(--lime)", "var(--blue)", "var(--ink)", "var(--purple)", "#ffcf47", "#ff7c72"];

export function DonutChart({ positions, centerLabel }: { positions?: TreasuryPosition[]; centerLabel?: string }) {
  const items = positions?.length ? positions : [
    { symbol: "USDG", allocation: 57 },
    { symbol: "Stock Tokens", allocation: 28.6 },
    { symbol: "Crypto", allocation: 7.9 },
    { symbol: "ETF", allocation: 6.5 },
  ];
  let cursor = 0;
  const segments = items.map((item, index) => {
    const start = cursor;
    cursor += item.allocation;
    return `${allocationColors[index % allocationColors.length]} ${start}% ${cursor}%`;
  });
  const largest = [...items].sort((a, b) => b.allocation - a.allocation)[0];
  return (
    <div className="donut-wrap">
      <div className="donut" style={{ background: `conic-gradient(${segments.join(",")})` }} />
      <div className="donut-label"><strong>{centerLabel ?? `${largest.allocation}%`}</strong><span>{largest.symbol}</span></div>
    </div>
  );
}

export function AllocationLegend({ positions }: { positions: TreasuryPosition[] }) {
  return <ul className="legend">{positions.map((position, index) => <li key={position.symbol}><i className="dot" style={{ background: allocationColors[index % allocationColors.length] }}/>{position.symbol}<b>{position.allocation}%</b></li>)}</ul>;
}

export function DistributionBars({ items }: { items: { label: string; percentage: number }[] }) {
  return <div className="distribution-bars">{items.map((item, index) => <div key={item.label}><div><span>{item.label}</span><b>{item.percentage}%</b></div><div className="distribution-track"><i style={{ width: `${item.percentage}%`, background: allocationColors[index % allocationColors.length] }}/></div></div>)}</div>;
}
