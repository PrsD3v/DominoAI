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
import {
  canAnswerApproval,
  formatTimestamp,
  stepKeyForApproval,
} from "@/lib/runs/screen";
import type {
  ApprovalRequest,
  StepRun,
  WorkflowRunStatus,
} from "@/types/workflow";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

function approvalVariant(status: ApprovalRequest["status"]): BadgeVariant {
  switch (status) {
    case "approved":
      return "default";
    case "rejected":
      return "destructive";
    case "pending":
      return "secondary";
    default:
      return "outline";
  }
}

export function ApprovalPanel({
  runId,
  runStatus,
  approvals,
  steps,
  pendingKey,
  onDecision,
}: {
  readonly runId: string;
  readonly runStatus: WorkflowRunStatus;
  readonly approvals: readonly ApprovalRequest[];
  readonly steps: readonly StepRun[];
  readonly pendingKey: string | null;
  readonly onDecision: (
    approval: ApprovalRequest,
    decision: "approve" | "reject",
  ) => void;
}) {
  const { locale, messages } = useI18n();
  const ordered = [...approvals].sort((left, right) => {
    if (left.status === "pending" && right.status !== "pending") {
      return -1;
    }

    if (right.status === "pending" && left.status !== "pending") {
      return 1;
    }

    return Date.parse(left.requestedAt) - Date.parse(right.requestedAt);
  });
  const answerable = canAnswerApproval(runStatus) && pendingKey === null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{messages.runs.detail.approvalsTitle}</CardTitle>
      </CardHeader>
      <CardContent>
        {ordered.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {messages.runs.detail.noApprovals}
          </p>
        ) : (
          <ul className="grid gap-3">
            {ordered.map((approval) => {
              const stepKey = stepKeyForApproval(steps, approval);
              const approving = pendingKey === `approve:${approval.id}`;
              const rejecting = pendingKey === `reject:${approval.id}`;

              return (
                <li
                  key={approval.id}
                  className="rounded-lg border border-border p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      {messages.runs.detail.stepLabel}{" "}
                      <code dir="ltr">{stepKey}</code>
                    </p>
                    <Badge variant={approvalVariant(approval.status)}>
                      {messages.statuses.approval[approval.status]}
                    </Badge>
                  </div>
                  <p dir="auto" className="mt-2 text-sm">
                    {approval.message}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <time dateTime={approval.requestedAt}>
                      {formatTimestamp(locale, approval.requestedAt)}
                    </time>
                  </p>

                  {approval.status === "pending" ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={!answerable}
                        onClick={() => onDecision(approval, "approve")}
                        aria-label={`${messages.runs.detail.approve} ${stepKey} — ${runId}`}
                      >
                        {approving
                          ? messages.runs.detail.answering
                          : messages.runs.detail.approve}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={!answerable}
                        onClick={() => onDecision(approval, "reject")}
                        aria-label={`${messages.runs.detail.reject} ${stepKey} — ${runId}`}
                      >
                        {rejecting
                          ? messages.runs.detail.answering
                          : messages.runs.detail.reject}
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
