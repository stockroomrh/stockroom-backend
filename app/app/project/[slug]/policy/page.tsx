import { PolicyView } from "@/components/project/PolicyView";
export default async function ProjectPolicyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PolicyView slug={slug}/>;
}
