import { WorkflowsScreen } from "@/components/workflows/workflows-screen";
import { getI18n } from "@/i18n/server";

export default async function WorkflowsPage() {
  const { messages } = await getI18n();

  return (
    <>
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {messages.nav.workflows}
      </p>
      <h1 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
        {messages.workflows.title}
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
        {messages.workflows.intro}
      </p>

      <WorkflowsScreen />
    </>
  );
}
