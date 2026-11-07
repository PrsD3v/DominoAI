"use client";

import { DirectionProvider } from "@base-ui/react/direction-provider";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/i18n/provider";
import type { Messages } from "@/i18n/messages";
import { postRunJson } from "@/lib/runs/client";
import {
  narrowProjectResponse,
  parseRunFieldErrors,
  type RunFailureCode,
} from "@/lib/runs/screen";
import {
  NO_PROFILE,
  projectFieldFromApi,
  projectFormBody,
  skillVersionGroups,
  toggleId,
  validateProjectDraft,
  workflowVersionGroups,
  type ProjectFieldName,
} from "@/lib/projects/screen";
import type {
  SkillCatalogResponse,
  WorkflowCatalogResponse,
} from "@/types/run-api";
import type { RuntimeProfile } from "@/types/runtime-settings";

function fieldMessage(
  messages: Messages,
  field: ProjectFieldName,
): string | null {
  switch (field) {
    case "name":
      return messages.projects.fields.nameRequired;
    case "workspaceRoot":
      return messages.projects.fields.workspaceRootRequired;
    case "workflowVersionIds":
      return messages.projects.fields.workflowVersionsRequired;
    case "defaultRuntimeProfileId":
      return messages.projects.fields.defaultProfileRequired;
    case "skillVersionIds":
      return messages.projects.fields.skillVersionsRequired;
    default:
      return null;
  }
}

export interface ProjectFormProps {
  readonly workflows: WorkflowCatalogResponse;
  readonly skills: SkillCatalogResponse;
  readonly profiles: readonly RuntimeProfile[];
  readonly onCreated: () => void;
}

export function ProjectForm({
  workflows,
  skills,
  profiles,
  onCreated,
}: ProjectFormProps) {
  const { dir, locale, messages } = useI18n();
  const [name, setName] = useState("");
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [defaultProfileId, setDefaultProfileId] = useState<string | null>(null);
  const [workflowVersionIds, setWorkflowVersionIds] = useState<readonly string[]>(
    [],
  );
  const [skillVersionIds, setSkillVersionIds] = useState<readonly string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<RunFailureCode | null>(null);
  const [fieldErrors, setFieldErrors] = useState<readonly ProjectFieldName[]>([]);
  const errorRef = useRef<HTMLDivElement>(null);
  const hasWorkflows = workflows.versions.length > 0;
  const workflowGroups = workflowVersionGroups(workflows);
  const skillGroups = skillVersionGroups(skills);

  useEffect(() => {
    if (failure !== null) {
      errorRef.current?.focus();
    }
  }, [failure, fieldErrors]);

  function clearFieldError(field: ProjectFieldName) {
    setFieldErrors((current) => current.filter((entry) => entry !== field));
    setFailure((current) =>
      current === "invalid_request" ? null : current,
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitting) {
      return;
    }

    const draft = {
      name,
      workspaceRoot,
      defaultRuntimeProfileId: defaultProfileId,
      workflowVersionIds,
      skillVersionIds,
    };
    const clientErrors = validateProjectDraft(draft);

    if (clientErrors.length > 0) {
      setFailure("invalid_request");
      setFieldErrors(clientErrors);
      return;
    }

    setSubmitting(true);
    setFailure(null);
    setFieldErrors([]);

    const result = await postRunJson("/api/projects", projectFormBody(draft));

    setSubmitting(false);

    if (!result.ok) {
      setFailure(result.code);
      setFieldErrors(
        parseRunFieldErrors(result.body)
          .map((entry) => projectFieldFromApi(entry.field))
          .filter((field): field is ProjectFieldName => field !== null),
      );
      return;
    }

    if (narrowProjectResponse(result.body) === null) {
      setFailure("unexpected");
      return;
    }

    setName("");
    setWorkspaceRoot("");
    setDefaultProfileId(null);
    setWorkflowVersionIds([]);
    setSkillVersionIds([]);
    onCreated();
  }

  const hasFieldMessages = fieldErrors.some(
    (field) => fieldMessage(messages, field) !== null,
  );

  return (
    <DirectionProvider direction={dir}>
      <Card>
        <CardHeader>
          <CardTitle>{messages.projects.registerTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid gap-5" noValidate>
            <p className="text-sm leading-6 text-muted-foreground">
              {messages.projects.registerIntro}
            </p>

            {failure !== null ? (
              <div
                ref={errorRef}
                id="project-form-error"
                tabIndex={-1}
                className="outline-none"
              >
                <Alert variant="destructive">
                  <AlertTitle>{messages.runErrors[failure]}</AlertTitle>
                  {hasFieldMessages ? (
                    <AlertDescription>
                      <ul className="list-disc space-y-1 ps-4">
                        {fieldErrors.map((field) => {
                          const message = fieldMessage(messages, field);

                          return message === null ? null : (
                            <li key={field}>{message}</li>
                          );
                        })}
                      </ul>
                    </AlertDescription>
                  ) : null}
                </Alert>
              </div>
            ) : null}

            {!hasWorkflows ? (
              <Alert>
                <AlertTitle>{messages.projects.notices.noWorkflows}</AlertTitle>
              </Alert>
            ) : null}

            {profiles.length === 0 ? (
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
            ) : null}

            <div className="grid gap-2">
              <Label htmlFor="project-name">{messages.projects.fields.name}</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  clearFieldError("name");
                }}
                disabled={submitting}
                required
                aria-invalid={fieldErrors.includes("name") || undefined}
                aria-describedby={
                  fieldErrors.includes("name")
                    ? "project-name-help project-form-error"
                    : "project-name-help"
                }
              />
              <p
                id="project-name-help"
                className="text-xs text-muted-foreground"
              >
                {messages.projects.fields.nameHelp}
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="project-workspace-root">
                {messages.projects.fields.workspaceRoot}
              </Label>
              <Input
                id="project-workspace-root"
                value={workspaceRoot}
                onChange={(event) => {
                  setWorkspaceRoot(event.target.value);
                  clearFieldError("workspaceRoot");
                }}
                disabled={submitting}
                required
                dir="ltr"
                spellCheck={false}
                autoComplete="off"
                className="font-mono"
                aria-invalid={
                  fieldErrors.includes("workspaceRoot") || undefined
                }
                aria-describedby={
                  fieldErrors.includes("workspaceRoot")
                    ? "project-workspace-root-help project-form-error"
                    : "project-workspace-root-help"
                }
              />
              <p
                id="project-workspace-root-help"
                className="text-xs text-muted-foreground"
              >
                {messages.projects.fields.workspaceRootHelp}
              </p>
            </div>

            <div className="grid gap-2">
              <Label
                id="project-profile-label"
                htmlFor="project-profile"
              >
                {messages.projects.fields.defaultProfile}
              </Label>
              <Select
                value={defaultProfileId ?? NO_PROFILE}
                onValueChange={(value) => {
                  if (typeof value !== "string") {
                    return;
                  }

                  setDefaultProfileId(value === NO_PROFILE ? null : value);
                }}
                disabled={submitting}
              >
                <SelectTrigger
                  id="project-profile"
                  className="w-full"
                  aria-labelledby="project-profile-label"
                  aria-invalid={
                    fieldErrors.includes("defaultRuntimeProfileId") || undefined
                  }
                  aria-describedby={
                    fieldErrors.includes("defaultRuntimeProfileId")
                      ? "project-profile-help project-form-error"
                      : "project-profile-help"
                  }
                >
                  <SelectValue
                    placeholder={messages.projects.options.noProfile}
                  />
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
              <p
                id="project-profile-help"
                className="text-xs text-muted-foreground"
              >
                {messages.projects.fields.defaultProfileHelp}
              </p>
            </div>

            <fieldset
              className="grid gap-3"
              aria-describedby={
                fieldErrors.includes("workflowVersionIds")
                  ? "project-workflow-help project-form-error"
                  : "project-workflow-help"
              }
            >
              <legend className="text-sm font-medium">
                {messages.projects.fields.workflowVersions}
              </legend>
              <p
                id="project-workflow-help"
                className="text-xs text-muted-foreground"
              >
                {messages.projects.fields.workflowVersionsHelp}
              </p>
              {workflowGroups.map((group) => (
                <div key={group.definition.id} className="grid gap-2">
                  <p className="text-sm font-medium">{group.definition.name}</p>
                  {group.versions.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {messages.workflows.noVersions}
                    </p>
                  ) : (
                    <ul className="grid gap-1.5">
                      {group.versions.map((version) => {
                        const checked = workflowVersionIds.includes(version.id);
                        const id = `project-workflow-${version.id}`;

                        return (
                          <li key={version.id}>
                            <label
                              htmlFor={id}
                              className="flex items-center gap-2 text-sm"
                            >
                              <input
                                id={id}
                                type="checkbox"
                                className="size-4"
                                checked={checked}
                                disabled={submitting}
                                onChange={() => {
                                  setWorkflowVersionIds((current) =>
                                    toggleId(current, version.id),
                                  );
                                  clearFieldError("workflowVersionIds");
                                }}
                              />
                              <span>
                                {messages.workflows.versionLabel} {version.version}
                              </span>
                              <code
                                dir="ltr"
                                className="text-xs text-muted-foreground"
                              >
                                {version.id}
                              </code>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              ))}
            </fieldset>

            <fieldset
              className="grid gap-3"
              aria-describedby={
                fieldErrors.includes("skillVersionIds")
                  ? "project-skill-help project-form-error"
                  : "project-skill-help"
              }
            >
              <legend className="text-sm font-medium">
                {messages.projects.fields.skillVersions}
              </legend>
              <p
                id="project-skill-help"
                className="text-xs text-muted-foreground"
              >
                {messages.projects.fields.skillVersionsHelp}
              </p>
              {skillGroups.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {messages.projects.notices.noSkillVersions}
                </p>
              ) : (
                skillGroups.map((group) => (
                  <div key={group.definition.id} className="grid gap-2">
                    <p className="text-sm font-medium">
                      {group.definition.name}
                    </p>
                    <ul className="grid gap-1.5">
                      {group.versions.map((version) => {
                        const checked = skillVersionIds.includes(version.id);
                        const id = `project-skill-${version.id}`;

                        return (
                          <li key={version.id}>
                            <label
                              htmlFor={id}
                              className="flex items-center gap-2 text-sm"
                            >
                              <input
                                id={id}
                                type="checkbox"
                                className="size-4"
                                checked={checked}
                                disabled={submitting}
                                onChange={() =>
                                  setSkillVersionIds((current) =>
                                    toggleId(current, version.id),
                                  )
                                }
                              />
                              <span>
                                {messages.workflows.versionLabel} {version.version}
                              </span>
                              <code
                                dir="ltr"
                                className="text-xs text-muted-foreground"
                              >
                                {version.id}
                              </code>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))
              )}
            </fieldset>

            <div>
              <Button
                type="submit"
                disabled={submitting || !hasWorkflows}
              >
                {submitting
                  ? messages.projects.actions.registering
                  : messages.projects.actions.register}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </DirectionProvider>
  );
}
