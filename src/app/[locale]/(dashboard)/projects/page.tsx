import { ProjectsScreen } from "@/components/projects/projects-screen";
import { getI18n } from "@/i18n/server";

export default async function ProjectsPage() {
  const { messages } = await getI18n();

  return (
    <>
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {messages.nav.projects}
      </p>
      <h1 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
        {messages.projects.title}
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
        {messages.projects.intro}
      </p>

      <ProjectsScreen />
    </>
  );
}
