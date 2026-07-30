import { ProjectSettingsView } from "@/components/dashboard/ProjectSettingsView";
export default async function ProjectSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ProjectSettingsView slug={slug}/>;
}
