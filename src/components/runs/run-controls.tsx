"use client";

import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useI18n } from "@/i18n/provider";
import { canCancel, canContinue, canPause } from "@/lib/runs/screen";
import type { RunSummary } from "@/types/run-api";

export type RunControlAction = "pause" | "continue" | "cancel";

export function RunControls({
  run,
  pendingKey,
  onAction,
}: {
  readonly run: RunSummary;
  readonly pendingKey: string | null;
  readonly onAction: (action: RunControlAction) => void;
}) {
  const { messages } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const pause = canPause(run.status);
  const resume = canContinue(run.status);
  const cancel = canCancel(run.status);

  if (!pause && !resume && !cancel) {
    return null;
  }

  const busy = pendingKey !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{messages.runs.detail.controlsTitle}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap gap-2">
          {pause ? (
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => onAction("pause")}
              aria-label={`${messages.runs.detail.pause} ${run.id}`}
            >
              {pendingKey === "pause"
                ? messages.runs.detail.pausePending
                : messages.runs.detail.pause}
            </Button>
          ) : null}

          {resume ? (
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => onAction("continue")}
              aria-label={`${messages.runs.detail.continue} ${run.id}`}
            >
              {pendingKey === "continue"
                ? messages.runs.detail.continuePending
                : messages.runs.detail.continue}
            </Button>
          ) : null}

          {cancel && !confirming ? (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => setConfirming(true)}
              aria-label={`${messages.runs.detail.cancel} ${run.id}`}
            >
              {pendingKey === "cancel"
                ? messages.runs.detail.cancelPending
                : messages.runs.detail.cancel}
            </Button>
          ) : null}
        </div>

        {confirming ? (
          <Alert variant="destructive">
            <AlertTitle>{messages.runs.detail.cancelConfirmTitle}</AlertTitle>
            <AlertDescription>
              <p>{messages.runs.detail.cancelConfirmBody}</p>
              <p className="mt-2">
                <code dir="ltr">{run.id}</code>
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => {
                    setConfirming(false);
                    onAction("cancel");
                  }}
                >
                  {pendingKey === "cancel"
                    ? messages.runs.detail.cancelPending
                    : messages.runs.detail.cancelConfirm}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirming(false)}
                >
                  {messages.runs.detail.keepRunning}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
