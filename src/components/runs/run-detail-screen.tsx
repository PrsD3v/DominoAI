"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApprovalPanel } from "@/components/runs/approval-panel";
import { EventFeed } from "@/components/runs/event-feed";
import { HistoryList } from "@/components/runs/history-list";
import { RunControls, type RunControlAction } from "@/components/runs/run-controls";
import { RunStatusBadge } from "@/components/runs/run-status-badge";
import { StepTimeline } from "@/components/runs/step-timeline";
import { useRunStream } from "@/components/runs/use-run-stream";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n/provider";
import { postRunJson, requestRunJson } from "@/lib/runs/client";
import {
  apiApprovalPath,
  apiRunActionPath,
  apiRunPath,
  elapsedMs,
  formatDuration,
  formatTimestamp,
  isTerminalRunStatus,
  narrowRunResponse,
  narrowWorkflowCatalogResponse,
  runWorkflowLabel,
  type RunFailureCode,
} from "@/lib/runs/screen";
import type {
  RunDetail,
  WorkflowCatalogResponse,
} from "@/types/run-api";
import type { ApprovalRequest } from "@/types/workflow";

interface ReadyState {
  readonly detail: RunDetail;
  readonly catalog: WorkflowCatalogResponse;
}

type InitialState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly code: RunFailureCode }
  | { readonly status: "ready"; readonly value: ReadyState };

const EMPTY_CATALOG: WorkflowCatalogResponse = {
  definitions: [],
  versions: [],
};

async function loadRun(runId: string): Promise<InitialState> {
  const [runResult, catalogResult] = await Promise.all([
    requestRunJson(apiRunPath(runId)),
    requestRunJson("/api/workflows"),
  ]);

  if (!runResult.ok) {
    return { status: "error", code: runResult.code };
  }

  const detail = narrowRunResponse(runResult.body);

  if (detail === null) {
    return { status: "error", code: "unexpected" };
  }

  const catalog =
    catalogResult.ok === true
      ? narrowWorkflowCatalogResponse(catalogResult.body) ?? EMPTY_CATALOG
      : EMPTY_CATALOG;

  return { status: "ready", value: { detail, catalog } };
}

function RunDetailLive({
  runId,
  initialDetail,
  catalog,
}: {
  readonly runId: string;
  readonly initialDetail: RunDetail;
  readonly catalog: WorkflowCatalogResponse;
}) {
  const { locale, messages } = useI18n();
  const { detail, status: streamStatus, reload, replaceDetail } =
    useRunStream(runId, initialDetail);
  const [now, setNow] = useState<number | null>(() =>
    Date.parse(initialDetail.run.updatedAt),
  );
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<RunFailureCode | null>(null);
  const run = detail.run;

  useEffect(() => {
    if (isTerminalRunStatus(run.status)) {
      return;
    }

    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [run.status]);

  async function perform(
    key: string,
    path: string,
    body?: unknown,
  ): Promise<void> {
    setPendingKey(key);
    setFailure(null);

    const result =
      body === undefined
        ? await requestRunJson(path, { method: "POST" })
        : await postRunJson(path, body);

    setPendingKey(null);

    if (!result.ok) {
      setFailure(result.code);

      if (
        result.code === "run_state_conflict" ||
        result.code === "approval_already_resolved" ||
        result.code === "run_not_found"
      ) {
        reload();
      }

      return;
    }

    const next = narrowRunResponse(result.body);

    if (next === null) {
      setFailure("unexpected");
      return;
    }

    replaceDetail(next);
  }

  function handleAction(action: RunControlAction) {
    void perform(action, apiRunActionPath(runId, action));
  }

  function handleDecision(
    approval: ApprovalRequest,
    decision: "approve" | "reject",
  ) {
    void perform(
      `${decision}:${approval.id}`,
      apiApprovalPath(runId, approval.id),
      { decision },
    );
  }

  const elapsed = formatDuration(
    elapsedMs(
      run.startedAt,
      run.finishedAt,
      now ?? Date.parse(run.startedAt ?? run.createdAt),
    ),
  );

  return (
    <div className="mt-8 grid gap-5">
      {failure !== null ? (
        <Alert variant="destructive">
          <AlertTitle>{messages.runErrors[failure]}</AlertTitle>
          <AlertDescription>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={reload}
            >
              {messages.runs.actions.reload}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {run.error !== undefined ? (
        <Alert variant="destructive">
          <AlertTitle>{messages.runs.detail.error}</AlertTitle>
          <AlertDescription>
            <pre
              dir="auto"
              className="whitespace-pre-wrap break-words text-xs"
            >
              {run.error}
            </pre>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <span>{messages.runs.detail.status}</span>
            <RunStatusBadge status={run.status} />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">
                {messages.runs.detail.runId}
              </dt>
              <dd>
                <code dir="ltr" className="break-all font-mono text-xs">
                  {run.id}
                </code>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {messages.runs.detail.project}
              </dt>
              <dd>{run.projectName ?? messages.runs.list.unknownProject}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {messages.runs.detail.workflow}
              </dt>
              <dd>{runWorkflowLabel(run, catalog)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">
                {messages.runs.detail.workspace}
              </dt>
              <dd>
                <code dir="ltr" className="break-all font-mono text-xs">
                  {run.workspaceRoot}
                </code>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {messages.runs.detail.elapsed}
              </dt>
              <dd className="font-mono">{elapsed}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {messages.runs.detail.created}
              </dt>
              <dd>
                <time dateTime={run.createdAt}>
                  {formatTimestamp(locale, run.createdAt)}
                </time>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {messages.runs.detail.started}
              </dt>
              <dd>
                {run.startedAt === undefined ? (
                  messages.common.notAvailable
                ) : (
                  <time dateTime={run.startedAt}>
                    {formatTimestamp(locale, run.startedAt)}
                  </time>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {messages.runs.detail.finished}
              </dt>
              <dd>
                {run.finishedAt === undefined ? (
                  messages.common.notAvailable
                ) : (
                  <time dateTime={run.finishedAt}>
                    {formatTimestamp(locale, run.finishedAt)}
                  </time>
                )}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <RunControls
        run={run}
        pendingKey={pendingKey}
        onAction={handleAction}
      />

      <ApprovalPanel
        runId={run.id}
        runStatus={run.status}
        approvals={detail.approvals}
        steps={detail.steps}
        pendingKey={pendingKey}
        onDecision={handleDecision}
      />

      <StepTimeline steps={detail.steps} now={now} />

      <EventFeed
        events={detail.events}
        steps={detail.steps}
        streamStatus={streamStatus}
        onReload={reload}
      />

      <HistoryList history={detail.history} />
    </div>
  );
}

export function RunDetailScreen({ runId }: { readonly runId: string }) {
  const { locale, messages } = useI18n();
  const [state, setState] = useState<InitialState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;

    void loadRun(runId).then((next) => {
      if (active) {
        setState(next);
      }
    });

    return () => {
      active = false;
    };
  }, [runId, reloadKey]);

  function retry() {
    setState({ status: "loading" });
    setReloadKey((current) => current + 1);
  }

  if (state.status === "loading") {
    return (
      <div role="status" className="mt-8 space-y-3">
        <p className="text-sm text-muted-foreground">
          {messages.common.loading}
        </p>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-52 w-full" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <Alert variant="destructive" className="mt-8">
        <AlertTitle>{messages.runErrors[state.code]}</AlertTitle>
        <AlertDescription>
          {state.code === "run_not_found" ? (
            <p>
              <Link
                href={`/${locale}/runs`}
                className="underline underline-offset-3"
              >
                {messages.runs.listTitle}
              </Link>
            </p>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={retry}
            >
              {messages.common.retry}
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <RunDetailLive
      runId={runId}
      initialDetail={state.value.detail}
      catalog={state.value.catalog}
    />
  );
}
