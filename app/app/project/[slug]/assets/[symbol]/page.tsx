import { AssetView } from "@/components/project/AssetView";
export default async function ProjectAssetPage({ params }: { params: Promise<{ slug: string; symbol: string }> }) {
  const { slug, symbol } = await params;
  return <AssetView slug={slug} symbol={decodeURIComponent(symbol)}/>;
}
