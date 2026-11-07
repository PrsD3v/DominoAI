"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useI18n } from "@/i18n/provider";
import { elapsedMs, formatDuration, formatTimestamp } from "@/lib/runs/screen";
import type { StepRun } from "@/types/workflow";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

function stepStatusVariant(status: StepRun["status"]): BadgeVariant {
  switch (status) {
    case "completed":
      return "default";
    case "failed":
      return "destructive";
    case "running":
      return "secondary";
    default:
      return "outline";
  }
}

export function StepTimeline({
  steps,
  now,
}: {
  readonly steps: readonly StepRun[];
  readonly now: number | null;
}) {
  const { locale, messages } = useI18n();
  const ordered = [...steps].sort(
    (left, right) => left.stepIndex - right.stepIndex,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{messages.runs.detail.stepsTitle}</CardTitle>
      </CardHeader>
      <CardContent>
        {ordered.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {messages.runs.detail.noSteps}
          </p>
        ) : (
          <ol className="grid gap-3">
            {ordered.map((step) => {
              const duration = formatDuration(
                elapsedMs(
                  step.startedAt,
                  step.finishedAt,
                  now ?? Date.parse(step.startedAt ?? step.createdAt),
                ),
              );

              return (
                <li
                  key={step.id}
                  className="rounded-lg border border-border p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span>{messages.runs.detail.stepLabel}</span>
                      <code dir="ltr">{step.stepKey}</code>
                      <Badge variant={stepStatusVariant(step.status)}>
                        {messages.statuses.step[step.status]}
                      </Badge>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {messages.runs.detail.attempts}: {step.attempts} /{" "}
                      {step.maxAttempts}
                      <span aria-hidden="true"> · </span>
                      {duration}
                    </p>
                  </div>

                  <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {step.startedAt !== undefined ? (
                      <div className="flex gap-1">
                        <dt>{messages.runs.detail.started}:</dt>
                        <dd>
                          <time dateTime={step.startedAt}>
                            {formatTimestamp(locale, step.startedAt)}
                          </time>
                        </dd>
                      </div>
                    ) : null}
                    {step.finishedAt !== undefined ? (
                      <div className="flex gap-1">
                        <dt>{messages.runs.detail.finished}:</dt>
                        <dd>
                          <time dateTime={step.finishedAt}>
                            {formatTimestamp(locale, step.finishedAt)}
                          </time>
                        </dd>
                      </div>
                    ) : null}
                  </dl>

                  {step.resultText !== undefined ? (
                    <div className="mt-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {messages.runs.detail.result}
                      </p>
                      <pre
                        dir="auto"
                        className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-xs"
                      >
                        {step.resultText}
                      </pre>
                    </div>
                  ) : null}

                  {step.error !== undefined ? (
                    <Alert variant="destructive" className="mt-2">
                      <AlertTitle>{messages.runs.detail.error}</AlertTitle>
                      <AlertDescription>
                        <pre
                          dir="auto"
                          className="whitespace-pre-wrap break-words text-xs"
                        >
                          {step.error}
                        </pre>
                      </AlertDescription>
                    </Alert>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
