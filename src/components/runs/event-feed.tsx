"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useI18n } from "@/i18n/provider";
import { formatTimestamp } from "@/lib/runs/screen";
import type { RunStreamStatus } from "@/components/runs/use-run-stream";
import type { RuntimeEventRecord, StepRun } from "@/types/workflow";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

function streamVariant(status: RunStreamStatus): BadgeVariant {
  switch (status) {
    case "live":
      return "default";
    case "reconnecting":
      return "destructive";
    default:
      return "outline";
  }
}

export function EventFeed({
  events,
  steps,
  streamStatus,
  onReload,
}: {
  readonly events: readonly RuntimeEventRecord[];
  readonly steps: readonly StepRun[];
  readonly streamStatus: RunStreamStatus;
  readonly onReload: () => void;
}) {
  const { locale, messages } = useI18n();
  const stepKeys = new Map(steps.map((step) => [step.id, step.stepKey]));

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{messages.runs.detail.eventsTitle}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <span role="status" aria-live="polite">
              <Badge variant={streamVariant(streamStatus)}>
                {messages.statuses.stream[streamStatus]}
              </Badge>
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onReload}
            >
              {messages.runs.detail.reloadStream}
            </Button>
          </div>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          {messages.runs.detail.streamHint}
        </p>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {messages.runs.detail.noEvents}
          </p>
        ) : (
          <ul className="grid gap-2">
            {events.map((record) => {
              const stepKey = stepKeys.get(record.stepRunId) ?? null;

              return (
                <li
                  key={record.id}
                  className="rounded-lg border border-border p-3"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <time dateTime={record.recordedAt}>
                      {formatTimestamp(locale, record.recordedAt)}
                    </time>
                    {stepKey === null ? null : (
                      <code dir="ltr" className="font-mono">
                        {stepKey}
                      </code>
                    )}
                  </div>
                  <pre
                    dir="auto"
                    className="mt-1 whitespace-pre-wrap break-words font-mono text-xs"
                  >
                    {record.event.text}
                  </pre>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
