import { AgentView } from "@/components/project/AgentView";
export default async function ProjectAgentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <AgentView slug={slug}/>;
}
