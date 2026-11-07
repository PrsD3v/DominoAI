"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useI18n } from "@/i18n/provider";
import { formatTimestamp } from "@/lib/runs/screen";
import type { WorkflowHistoryEntry } from "@/types/workflow";

export function HistoryList({
  history,
}: {
  readonly history: readonly WorkflowHistoryEntry[];
}) {
  const { locale, messages } = useI18n();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{messages.runs.detail.historyTitle}</CardTitle>
      </CardHeader>
      <CardContent>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {messages.runs.detail.noHistory}
          </p>
        ) : (
          <ol className="grid gap-2">
            {history.map((entry) => (
              <li key={entry.id} className="text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {messages.historyKinds[entry.kind]}
                  </span>
                  <time
                    dateTime={entry.createdAt}
                    className="text-xs text-muted-foreground"
                  >
                    {formatTimestamp(locale, entry.createdAt)}
                  </time>
                </div>
                <code
                  dir="auto"
                  className="mt-0.5 block text-xs text-muted-foreground"
                >
                  {entry.message}
                </code>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
