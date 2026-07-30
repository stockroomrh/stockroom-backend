import { ProjectManagementView } from "@/components/dashboard/ProjectManagementView";
export default async function ProjectManagementPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ProjectManagementView slug={slug}/>;
}
