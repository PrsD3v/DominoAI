import Link from "next/link";
import { RunDetailScreen } from "@/components/runs/run-detail-screen";
import { Button } from "@/components/ui/button";
import { getI18n } from "@/i18n/server";
import { shortRunId } from "@/lib/runs/screen";

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const { messages } = await getI18n();

  return (
    <>
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {messages.nav.runs}
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {messages.runs.detail.runId}{" "}
          <code dir="ltr" className="font-mono text-2xl">
            {shortRunId(id)}
          </code>
        </h1>
        <Button
          variant="outline"
          size="sm"
          render={<Link href={`/${locale}/runs`} />}
        >
          {messages.common.back}
        </Button>
      </div>

      <RunDetailScreen runId={id} />
    </>
  );
}
