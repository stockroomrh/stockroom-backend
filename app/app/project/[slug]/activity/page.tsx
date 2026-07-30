import { ActivityView } from "@/components/project/ActivityView";
export default async function ProjectActivityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ActivityView slug={slug}/>;
}
