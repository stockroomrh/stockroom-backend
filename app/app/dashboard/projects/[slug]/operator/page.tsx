import { OperatorView } from "@/components/dashboard/OperatorView";
export default async function ProjectOperatorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <OperatorView slug={slug}/>;
}
