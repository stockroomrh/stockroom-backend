export function formatCurrency(value: number, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits, minimumFractionDigits: maximumFractionDigits }).format(value);
}

export function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

export function shortenAddress(value: string, front = 6, back = 4) {
  return `${value.slice(0, front)}…${value.slice(-back)}`;
}
