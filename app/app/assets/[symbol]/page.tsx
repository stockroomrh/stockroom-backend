import { redirect } from "next/navigation";
export default async function LegacyAssetPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  redirect(`/app/project/stockroom/assets/${encodeURIComponent(symbol)}`);
}
