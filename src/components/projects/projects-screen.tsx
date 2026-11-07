"use client";

import { DirectionProvider } from "@base-ui/react/direction-provider";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ProjectForm } from "@/components/projects/project-form";
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
import type { Messages } from "@/i18n/messages";
import {
  NO_PROFILE,
  applyDefaultProfile,
  profileOptionLabel,
  selectedWorkflowLabels,
  skillVersionLabel,
} from "@/lib/projects/screen";
import { requestRunJson } from "@/lib/runs/client";
import {
  formatTimestamp,
  narrowProjectListResponse,
  narrowSkillCatalogResponse,
  narrowWorkflowCatalogResponse,
  type RunFailureCode,
} from "@/lib/runs/screen";
import { requestSettingsJson } from "@/lib/settings/client";
import {
  narrowProfilesResponse,
  type SettingsFailureCode,
} from "@/lib/settings/screen";
import type { Project } from "@/types/persistence";
import type {
  SkillCatalogResponse,
  WorkflowCatalogResponse,
} from "@/types/run-api";
import type { RuntimeProfile } from "@/types/runtime-settings";

interface ProjectsData {
  readonly projects: readonly Project[];
  readonly workflows: WorkflowCatalogResponse;
  readonly skills: SkillCatalogResponse;
  readonly profiles: readonly RuntimeProfile[];
}

type LoadFailure =
  | { readonly source: "run"; readonly code: RunFailureCode }
  | { readonly source: "settings"; readonly code: SettingsFailureCode };

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly value: ProjectsData }
  | { readonly status: "error"; readonly failure: LoadFailure };

function failureMessage(messages: Messages, failure: LoadFailure): string {
  return failure.source === "run"
    ? messages.runErrors[failure.code]
    : messages.settings.errors[failure.code];
}

async function loadProjects(): Promise<LoadState> {
  const [projectsResult, workflowsResult, skillsResult, profilesResult] =
    await Promise.all([
      requestRunJson("/api/projects"),
      requestRunJson("/api/workflows"),
      requestRunJson("/api/skills"),
      requestSettingsJson("/api/settings/profiles"),
    ]);

  if (!projectsResult.ok) {
    return {
      status: "error",
      failure: { source: "run", code: projectsResult.code },
    };
  }

  if (!workflowsResult.ok) {
    return {
      status: "error",
      failure: { source: "run", code: workflowsResult.code },
    };
  }

  if (!skillsResult.ok) {
    return {
      status: "error",
      failure: { source: "run", code: skillsResult.code },
    };
  }

  if (!profilesResult.ok) {
    return {
      status: "error",
      failure: { source: "settings", code: profilesResult.code },
    };
  }

  const projects = narrowProjectListResponse(projectsResult.body);
  const workflows = narrowWorkflowCatalogResponse(workflowsResult.body);
  const skills = narrowSkillCatalogResponse(skillsResult.body);
  const views = narrowProfilesResponse(profilesResult.body);

  if (projects === null || workflows === null || skills === null) {
    return {
      status: "error",
      failure: { source: "run", code: "unexpected" },
    };
  }

  if (views === null) {
    return {
      status: "error",
      failure: { source: "settings", code: "unexpected" },
    };
  }

  return {
    status: "ready",
    value: {
      projects,
      workflows,
      skills,
      profiles: views.map((view) => view.profile),
    },
  };
}

function readDefaultProfile(value: unknown): string | null | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const profileId = record.defaultRuntimeProfileId;

  if (profileId === null) {
    return null;
  }

  return typeof profileId === "string" ? profileId : undefined;
}

function ProjectProfileControl({
  project,
  profiles,
  onUpdated,
}: {
  readonly project: Project;
  readonly profiles: readonly RuntimeProfile[];
  readonly onUpdated: (projectId: string, profileId: string | null) => void;
}) {
  const { dir, locale, messages } = useI18n();
  const [selected, setSelected] = useState(
    project.defaultRuntimeProfileId ?? NO_PROFILE,
  );
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<SettingsFailureCode | null>(null);
  const unchanged = selected === (project.defaultRuntimeProfileId ?? NO_PROFILE);

  async function save() {
    if (saving) {
      return;
    }

    setSaving(true);
    setFailure(null);

    const result = await requestSettingsJson(
      `/api/settings/projects/${encodeURIComponent(project.id)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          defaultRuntimeProfileId: selected === NO_PROFILE ? null : selected,
        }),
      },
    );

    setSaving(false);

    if (!result.ok) {
      setFailure(result.code);
      return;
    }

    const profileId = readDefaultProfile(result.body);

    if (profileId === undefined) {
      setFailure("unexpected");
      return;
    }

    onUpdated(project.id, profileId);
  }

  if (profiles.length === 0) {
    return (
      <div className="grid gap-2">
        <p className="text-sm font-medium">
          {messages.projects.fields.defaultProfile}
        </p>
        <Alert>
          <AlertTitle>{messages.projects.notices.noProfiles}</AlertTitle>
          <AlertDescription>
            <Link
              href={`/${locale}/settings`}
              className="underline underline-offset-3"
            >
              {messages.nav.settings}
            </Link>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <DirectionProvider direction={dir}>
      <div className="grid gap-2">
        <Label id={`project-profile-${project.id}-label`} htmlFor={`project-profile-${project.id}`}>
          {messages.projects.fields.defaultProfile}
        </Label>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={selected}
            onValueChange={(value) => {
              if (typeof value !== "string") {
                return;
              }

              setSelected(value);
              setFailure(null);
            }}
            disabled={saving}
          >
            <SelectTrigger
              id={`project-profile-${project.id}`}
              className="min-w-48"
              aria-labelledby={`project-profile-${project.id}-label`}
              aria-describedby={`project-profile-${project.id}-help`}
            >
              <SelectValue placeholder={messages.projects.options.noProfile} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_PROFILE}>
                {messages.projects.options.noProfile}
              </SelectItem>
              {profiles.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  {profile.label} — {profile.providerName} / {profile.model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            onClick={save}
            disabled={saving || unchanged}
          >
            {saving
              ? messages.projects.actions.savingProfile
              : messages.projects.actions.saveProfile}
          </Button>
        </div>
        <p
          id={`project-profile-${project.id}-help`}
          className="text-xs text-muted-foreground"
        >
          {messages.projects.fields.defaultProfileHelp}
        </p>
        {failure !== null ? (
          <Alert variant="destructive">
            <AlertTitle>{messages.settings.errors[failure]}</AlertTitle>
          </Alert>
        ) : null}
      </div>
    </DirectionProvider>
  );
}

function ProjectCard({
  project,
  data,
  onUpdated,
}: {
  readonly project: Project;
  readonly data: ProjectsData;
  readonly onUpdated: (projectId: string, profileId: string | null) => void;
}) {
  const { locale, messages } = useI18n();
  const versions = selectedWorkflowLabels(project, data.workflows);
  const profile = profileOptionLabel(
    data.profiles,
    project.defaultRuntimeProfileId,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span>{project.name}</span>
          <Badge variant="outline">
            {profile ??
              (project.defaultRuntimeProfileId === undefined
                ? messages.projects.options.noProfile
                : messages.common.unknown)}
          </Badge>
        </CardTitle>
        <CardDescription>
          <code dir="ltr" className="break-all font-mono text-xs">
            {project.workspaceRoot}
          </code>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1">
            <p className="text-sm font-medium">
              {messages.projects.lists.workflowVersions} (
              {project.workflowVersionIds.length})
            </p>
            {versions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {messages.runs.notices.noVersions}
              </p>
            ) : (
              <ul className="grid gap-1">
                {versions.map((label, index) => (
                  <li
                    key={`${label}-${index}`}
                    className="text-sm text-muted-foreground"
                  >
                    {label}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid gap-1">
            <p className="text-sm font-medium">
              {messages.projects.lists.skillVersions} (
              {project.skillVersionIds.length})
            </p>
            {project.skillVersionIds.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {messages.projects.lists.noSkills}
              </p>
            ) : (
              <ul className="grid gap-1">
                {project.skillVersionIds.map((id) => (
                  <li key={id} className="text-sm text-muted-foreground">
                    {skillVersionLabel(data.skills, id)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          {messages.projects.lists.registeredAt}:{" "}
          <time dateTime={project.createdAt}>
            {formatTimestamp(locale, project.createdAt)}
          </time>
        </p>

        <ProjectProfileControl
          key={`${project.id}-${project.defaultRuntimeProfileId ?? "none"}`}
          project={project}
          profiles={data.profiles}
          onUpdated={onUpdated}
        />
      </CardContent>
    </Card>
  );
}

export function ProjectsScreen() {
  const { messages } = useI18n();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [feedback, setFeedback] = useState<
    "created" | "profileUpdated" | null
  >(null);

  useEffect(() => {
    let active = true;

    void loadProjects().then((next) => {
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

  function handleCreated() {
    setFeedback("created");
    refresh();
  }

  function handleProfileUpdated(projectId: string, profileId: string | null) {
    setFeedback("profileUpdated");
    setState((current) => {
      if (current.status !== "ready") {
        return current;
      }

      return {
        status: "ready",
        value: {
          ...current.value,
          projects: current.value.projects.map((project) =>
            project.id === projectId
              ? applyDefaultProfile(project, profileId)
              : project,
          ),
        },
      };
    });
  }

  return (
    <section className="mt-8 space-y-5" aria-labelledby="projects-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="projects-title" className="text-lg font-semibold">
          {messages.projects.listTitle}
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

      {feedback !== null ? (
        <Alert role="status">
          <AlertTitle>
            {feedback === "created"
              ? messages.projects.feedback.created
              : messages.projects.feedback.profileUpdated}
          </AlertTitle>
        </Alert>
      ) : null}

      {state.status === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>{failureMessage(messages, state.failure)}</AlertTitle>
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
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : null}

      {state.status === "ready" ? (
        <>
          <ProjectForm
            workflows={state.value.workflows}
            skills={state.value.skills}
            profiles={state.value.profiles}
            onCreated={handleCreated}
          />

          {state.value.projects.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{messages.projects.emptyTitle}</CardTitle>
                <CardDescription>{messages.projects.emptyBody}</CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <div className="grid gap-4">
              {state.value.projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  data={state.value}
                  onUpdated={handleProfileUpdated}
                />
              ))}
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
