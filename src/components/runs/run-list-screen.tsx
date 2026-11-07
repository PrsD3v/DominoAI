"use client";

import { DirectionProvider } from "@base-ui/react/direction-provider";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { RunStatusBadge } from "@/components/runs/run-status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n/provider";
import { postRunJson, requestRunJson } from "@/lib/runs/client";
import {
  formatDuration,
  formatTimestamp,
  initialWorkflowVersionId,
  narrowProjectListResponse,
  narrowRunListResponse,
  narrowRunResponse,
  narrowWorkflowCatalogResponse,
  pageRunPath,
  runDurationMs,
  runWorkflowLabel,
  sortRunsNewestFirst,
  workflowVersionsForProject,
  type RunFailureCode,
} from "@/lib/runs/screen";
import type { Project } from "@/types/persistence";
import type {
  RunSummary,
  WorkflowCatalogResponse,
} from "@/types/run-api";

interface RunsData {
  readonly projects: readonly Project[];
  readonly workflows: WorkflowCatalogResponse;
  readonly runs: readonly RunSummary[];
  readonly loadedAt: number;
}

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly value: RunsData }
  | { readonly status: "error"; readonly code: RunFailureCode };

async function loadRuns(): Promise<LoadState> {
  const [projectsResult, workflowsResult, runsResult] = await Promise.all([
    requestRunJson("/api/projects"),
    requestRunJson("/api/workflows"),
    requestRunJson("/api/runs"),
  ]);

  if (!projectsResult.ok) {
    return { status: "error", code: projectsResult.code };
  }

  if (!workflowsResult.ok) {
    return { status: "error", code: workflowsResult.code };
  }

  if (!runsResult.ok) {
    return { status: "error", code: runsResult.code };
  }

  const projects = narrowProjectListResponse(projectsResult.body);
  const workflows = narrowWorkflowCatalogResponse(workflowsResult.body);
  const runs = narrowRunListResponse(runsResult.body);

  if (projects === null || workflows === null || runs === null) {
    return { status: "error", code: "unexpected" };
  }

  return {
    status: "ready",
    value: { projects, workflows, runs: runs.runs, loadedAt: Date.now() },
  };
}

function StartRunForm({
  projects,
  workflows,
}: {
  readonly projects: readonly Project[];
  readonly workflows: WorkflowCatalogResponse;
}) {
  const { dir, locale, messages } = useI18n();
  const router = useRouter();
  const firstProject = projects[0] ?? null;
  const [projectId, setProjectId] = useState<string | null>(
    firstProject?.id ?? null,
  );
  const [workflowVersionId, setWorkflowVersionId] = useState<string | null>(
    firstProject === null
      ? null
      : initialWorkflowVersionId(firstProject, workflows),
  );
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<RunFailureCode | null>(null);
  const [fieldError, setFieldError] = useState<
    "projectId" | "workflowVersionId" | null
  >(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const project = projects.find((entry) => entry.id === projectId) ?? null;
  const versions =
    project === null ? [] : workflowVersionsForProject(project, workflows);

  useEffect(() => {
    if (failure !== null) {
      errorRef.current?.focus();
    }
  }, [failure, fieldError]);

  function selectProject(id: string) {
    const next = projects.find((entry) => entry.id === id) ?? null;

    setProjectId(id);
    setWorkflowVersionId(
      next === null ? null : initialWorkflowVersionId(next, workflows),
    );
    setFailure(null);
    setFieldError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitting) {
      return;
    }

    if (projectId === null) {
      setFailure("invalid_request");
      setFieldError("projectId");
      return;
    }

    if (workflowVersionId === null) {
      setFailure("invalid_request");
      setFieldError("workflowVersionId");
      return;
    }

    setSubmitting(true);
    setFailure(null);
    setFieldError(null);

    const result = await postRunJson("/api/runs", {
      projectId,
      workflowVersionId,
    });

    if (!result.ok) {
      setSubmitting(false);
      setFailure(result.code);
      return;
    }

    const detail = narrowRunResponse(result.body);

    if (detail === null) {
      setSubmitting(false);
      setFailure("unexpected");
      return;
    }

    router.push(pageRunPath(locale, detail.run.id));
  }

  return (
    <DirectionProvider direction={dir}>
      <Card>
        <CardHeader>
          <CardTitle>{messages.runs.startTitle}</CardTitle>
          <CardDescription>{messages.runs.startIntro}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
            {failure !== null ? (
              <div
                ref={errorRef}
                id="start-run-error"
                tabIndex={-1}
                className="outline-none"
              >
                <Alert variant="destructive">
                  <AlertTitle>{messages.runErrors[failure]}</AlertTitle>
                  {fieldError !== null ? (
                    <AlertDescription>
                      {fieldError === "projectId"
                        ? messages.runs.fields.projectRequired
                        : messages.runs.fields.workflowVersionRequired}
                    </AlertDescription>
                  ) : null}
                </Alert>
              </div>
            ) : null}

            {projects.length === 0 ? (
              <Alert>
                <AlertTitle>{messages.runs.notices.noProjects}</AlertTitle>
                <AlertDescription>
                  <Link
                    href={`/${locale}/projects`}
                    className="underline underline-offset-3"
                  >
                    {messages.nav.projects}
                  </Link>
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-2">
              <Label id="start-run-project-label" htmlFor="start-run-project">
                {messages.runs.fields.project}
              </Label>
              <Select
                value={projectId}
                onValueChange={(value) => {
                  if (typeof value === "string") {
                    selectProject(value);
                  }
                }}
                disabled={submitting || projects.length === 0}
              >
                <SelectTrigger
                  id="start-run-project"
                  className="w-full"
                  aria-labelledby="start-run-project-label"
                  aria-describedby="start-run-project-help"
                  aria-invalid={fieldError === "projectId" || undefined}
                >
                  <SelectValue placeholder={messages.runs.fields.project} />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p
                id="start-run-project-help"
                className="text-xs text-muted-foreground"
              >
                {messages.runs.fields.projectHelp}
              </p>
            </div>

            <div className="grid gap-2">
              <Label
                id="start-run-version-label"
                htmlFor="start-run-version"
              >
                {messages.runs.fields.workflowVersion}
              </Label>
              <Select
                value={workflowVersionId}
                onValueChange={(value) => {
                  if (typeof value === "string") {
                    setWorkflowVersionId(value);
                    setFailure(null);
                    setFieldError(null);
                  }
                }}
                disabled={submitting || versions.length === 0}
              >
                <SelectTrigger
                  id="start-run-version"
                  className="w-full"
                  aria-labelledby="start-run-version-label"
                  aria-describedby="start-run-version-help"
                  aria-invalid={
                    fieldError === "workflowVersionId" || undefined
                  }
                >
                  <SelectValue
                    placeholder={messages.runs.fields.workflowVersion}
                  />
                </SelectTrigger>
                <SelectContent>
                  {versions.map((version) => (
                    <SelectItem key={version.id} value={version.id}>
                      {messages.workflows.versionLabel} {version.version} —{" "}
                      {version.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p
                id="start-run-version-help"
                className="text-xs text-muted-foreground"
              >
                {messages.runs.fields.workflowVersionHelp}
              </p>
            </div>

            {project !== null && versions.length === 0 ? (
              <Alert>
                <AlertTitle>{messages.runs.notices.noVersions}</AlertTitle>
              </Alert>
            ) : null}

            {project !== null && project.defaultRuntimeProfileId === undefined ? (
              <Alert>
                <AlertTitle>{messages.runs.notices.noProfile}</AlertTitle>
                <AlertDescription>
                  <Link
                    href={`/${locale}/projects`}
                    className="underline underline-offset-3"
                  >
                    {messages.nav.projects}
                  </Link>
                </AlertDescription>
              </Alert>
            ) : null}

            <div>
              <Button
                type="submit"
                disabled={
                  submitting ||
                  projects.length === 0 ||
                  versions.length === 0
                }
              >
                {submitting
                  ? messages.runs.actions.starting
                  : messages.runs.actions.start}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </DirectionProvider>
  );
}

export function RunListScreen() {
  const { locale, messages } = useI18n();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;

    void loadRuns().then((next) => {
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

  const now = state.status === "ready" ? state.value.loadedAt : 0;

  return (
    <>
      {state.status === "ready" ? (
        <StartRunForm
          projects={state.value.projects}
          workflows={state.value.workflows}
        />
      ) : null}

      <section className="mt-8 space-y-5" aria-labelledby="runs-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="runs-title" className="text-lg font-semibold">
            {messages.runs.listTitle}
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
            <Skeleton className="h-24 w-full" />
          </div>
        ) : null}

        {state.status === "ready" ? (
          state.value.runs.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{messages.runs.emptyTitle}</CardTitle>
                <CardDescription>{messages.runs.emptyBody}</CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[44rem] text-sm">
                <caption className="sr-only">
                  {messages.runs.listTitle}
                </caption>
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-start">
                    <th scope="col" className="px-3 py-2 text-start font-medium">
                      {messages.runs.list.status}
                    </th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">
                      {messages.runs.list.project}
                    </th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">
                      {messages.runs.list.workflow}
                    </th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">
                      {messages.runs.list.created}
                    </th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">
                      {messages.runs.list.duration}
                    </th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">
                      {messages.runs.list.actions}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortRunsNewestFirst(state.value.runs).map((run) => (
                    <tr key={run.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">
                        <RunStatusBadge status={run.status} />
                      </td>
                      <td className="px-3 py-2">
                        {run.projectName ?? messages.runs.list.unknownProject}
                      </td>
                      <td className="px-3 py-2">
                        {runWorkflowLabel(run, state.value.workflows)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        <time dateTime={run.createdAt}>
                          {formatTimestamp(locale, run.createdAt)}
                        </time>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {formatDuration(runDurationMs(run, now))}
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          variant="outline"
                          size="sm"
                          render={
                            <Link href={pageRunPath(locale, run.id)} />
                          }
                        >
                          {messages.runs.actions.open}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}
      </section>
    </>
  );
}
