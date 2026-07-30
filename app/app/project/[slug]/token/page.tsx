import { TokenView } from "@/components/project/TokenView";
export default async function ProjectTokenPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <TokenView slug={slug}/>;
}
