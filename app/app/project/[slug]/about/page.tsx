import { AboutView } from "@/components/project/AboutView";
export default async function ProjectAboutPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <AboutView slug={slug}/>;
}
