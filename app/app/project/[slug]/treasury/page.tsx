import { TreasuryView } from "@/components/project/TreasuryView";
export default async function ProjectTreasuryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <TreasuryView slug={slug}/>;
}
