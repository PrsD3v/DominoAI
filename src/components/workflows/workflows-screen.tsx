"use client";

import { useEffect, useState } from "react";
import { RunStatusBadge } from "@/components/runs/run-status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n/provider";
import { requestRunJson } from "@/lib/runs/client";
import {
  formatTimestamp,
  narrowRunListResponse,
  narrowSkillCatalogResponse,
  narrowWorkflowCatalogResponse,
  type RunFailureCode,
} from "@/lib/runs/screen";
import {
  stepViews,
  workflowDefinitionViews,
} from "@/lib/workflows/screen";
import type {
  RunSummary,
  SkillCatalogResponse,
  WorkflowCatalogResponse,
} from "@/types/run-api";

interface WorkflowsData {
  readonly workflows: WorkflowCatalogResponse;
  readonly skills: SkillCatalogResponse;
  readonly runs: readonly RunSummary[];
}

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly value: WorkflowsData }
  | { readonly status: "error"; readonly code: RunFailureCode };

async function loadWorkflows(): Promise<LoadState> {
  const [workflowsResult, skillsResult, runsResult] = await Promise.all([
    requestRunJson("/api/workflows"),
    requestRunJson("/api/skills"),
    requestRunJson("/api/runs"),
  ]);

  if (!workflowsResult.ok) {
    return { status: "error", code: workflowsResult.code };
  }

  if (!skillsResult.ok) {
    return { status: "error", code: skillsResult.code };
  }

  if (!runsResult.ok) {
    return { status: "error", code: runsResult.code };
  }

  const workflows = narrowWorkflowCatalogResponse(workflowsResult.body);
  const skills = narrowSkillCatalogResponse(skillsResult.body);
  const runs = narrowRunListResponse(runsResult.body);

  if (workflows === null || skills === null || runs === null) {
    return { status: "error", code: "unexpected" };
  }

  return { status: "ready", value: { workflows, skills, runs: runs.runs } };
}

function WorkflowDefinitionCard({
  view,
  skills,
}: {
  readonly view: ReturnType<typeof workflowDefinitionViews>[number];
  readonly skills: SkillCatalogResponse;
}) {
  const { locale, messages } = useI18n();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span>{view.definition.name}</span>
          {view.latest === null ? (
            <Badge variant="outline">{messages.workflows.noVersions}</Badge>
          ) : (
            <Badge variant="secondary">
              {messages.workflows.latestBadge}:{" "}
              {messages.workflows.versionLabel} {view.latest.version}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          <code dir="ltr" className="font-mono text-xs">
            {view.definition.id}
          </code>
        </CardDescription>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{messages.workflows.lastRunTitle}:</span>
          {view.lastRun === null ? (
            <span>{messages.workflows.noRuns}</span>
          ) : (
            <>
              <RunStatusBadge status={view.lastRun.status} />
              <time dateTime={view.lastRun.createdAt}>
                {formatTimestamp(locale, view.lastRun.createdAt)}
              </time>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <h3 className="text-sm font-medium">
          {messages.workflows.versionsTitle}
        </h3>
        {view.versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {messages.workflows.noVersions}
          </p>
        ) : (
          <ul className="grid gap-3">
            {view.versions.map((version) => {
              const steps = stepViews(version, skills);

              return (
                <li
                  key={version.id}
                  className="rounded-lg border border-border p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      {messages.workflows.versionLabel} {version.version}
                      {version.id === view.latest?.id ? (
                        <Badge variant="outline" className="ms-2">
                          {messages.workflows.latestBadge}
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {messages.workflows.publishedAt}:{" "}
                      <time dateTime={version.publishedAt}>
                        {formatTimestamp(locale, version.publishedAt)}
                      </time>
                    </p>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-1">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {messages.workflows.stepsTitle}
                      </p>
                      <ol className="grid gap-2">
                        {steps.map((entry) => (
                          <li key={entry.step.key} className="text-sm">
                            <span className="font-medium">
                              {messages.workflows.stepLabel}{" "}
                              <code dir="ltr">{entry.step.key}</code>
                            </span>
                            {entry.skillLabels.length > 0 ? (
                              <span className="mt-1 flex flex-wrap gap-1">
                                {entry.skillLabels.map((label, index) => (
                                  <Badge
                                    key={`${label}-${index}`}
                                    variant="outline"
                                  >
                                    {label}
                                  </Badge>
                                ))}
                              </span>
                            ) : null}
                            {entry.approvalMessage !== null ? (
                              <span className="mt-1 block text-xs text-muted-foreground">
                                {entry.approvalMessage}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    </div>

                    <div className="grid content-start gap-1">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {messages.workflows.approvalPointsTitle}
                      </p>
                      {version.approvalPoints.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          {messages.workflows.noApprovalPoints}
                        </p>
                      ) : (
                        <ul className="grid gap-1">
                          {version.approvalPoints.map((point) => (
                            <li key={point.key} className="text-sm">
                              <code dir="ltr" className="font-mono text-xs">
                                {point.key}
                              </code>
                              <span className="block text-xs text-muted-foreground">
                                {point.message}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>

                  <p className="mt-3 text-xs text-muted-foreground">
                    {messages.workflows.skillVersionsTitle}:{" "}
                    {steps.flatMap((entry) => entry.skillLabels).length === 0
                      ? messages.workflows.noSkillVersions
                      : steps
                          .flatMap((entry) => entry.skillLabels)
                          .join(", ")}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function WorkflowsScreen() {
  const { messages } = useI18n();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;

    void loadWorkflows().then((next) => {
      if (active) {
        setState(next);
      }
    });

    return () => {
      active = false;
    };
  }, [reloadKey]);

  function refresh() {
    setState({ status: "loading" });
    setReloadKey((current) => current + 1);
  }

  return (
    <section className="mt-8 space-y-5" aria-labelledby="workflows-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="workflows-title" className="text-lg font-semibold">
          {messages.workflows.definitionsTitle}
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={state.status === "loading"}
        >
          {messages.common.refresh}
        </Button>
      </div>

      {state.status === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>{messages.runErrors[state.code]}</AlertTitle>
          <AlertDescription>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={refresh}
            >
              {messages.common.retry}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {state.status === "loading" ? (
        <div role="status" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {messages.common.loading}
          </p>
          <Skeleton className="h-40 w-full" />
        </div>
      ) : null}

      {state.status === "ready" ? (
        state.value.workflows.definitions.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>{messages.workflows.emptyTitle}</CardTitle>
              <CardDescription>{messages.workflows.emptyBody}</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-4">
            {workflowDefinitionViews(
              state.value.workflows,
              state.value.runs,
            ).map((view) => (
              <WorkflowDefinitionCard
                key={view.definition.id}
                view={view}
                skills={state.value.skills}
              />
            ))}
          </div>
        )
      ) : null}
    </section>
  );
}
