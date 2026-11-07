import { RunListScreen } from "@/components/runs/run-list-screen";
import { getI18n } from "@/i18n/server";

export default async function RunsPage() {
  const { messages } = await getI18n();

  return (
    <>
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {messages.nav.runs}
      </p>
      <h1 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
        {messages.runs.title}
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
        {messages.runs.intro}
      </p>

      <RunListScreen />
    </>
  );
}
