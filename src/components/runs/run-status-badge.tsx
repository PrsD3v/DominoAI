"use client";

import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/i18n/provider";
import type { WorkflowRunStatus } from "@/types/workflow";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

function runStatusVariant(status: WorkflowRunStatus): BadgeVariant {
  switch (status) {
    case "completed":
      return "default";
    case "failed":
      return "destructive";
    case "running":
      return "secondary";
    case "waiting_approval":
      return "secondary";
    default:
      return "outline";
  }
}

export function RunStatusBadge({ status }: { readonly status: WorkflowRunStatus }) {
  const { messages } = useI18n();

  return (
    <Badge variant={runStatusVariant(status)}>
      {messages.statuses.run[status]}
    </Badge>
  );
}
