import { ProjectOverview } from "@/components/project/ProjectOverview";
export default async function PublicProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ProjectOverview slug={slug}/>;
}
