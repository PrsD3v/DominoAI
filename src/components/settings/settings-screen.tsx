"use client";

import { useEffect, useState } from "react";
import { CredentialPanel } from "@/components/settings/credential-panel";
import { ProfileForm } from "@/components/settings/profile-form";
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
import { requestSettingsJson } from "@/lib/settings/client";
import {
  groupProfilesByApiKeyEnv,
  narrowCatalogResponse,
  narrowProfilesResponse,
  type SettingsFailureCode,
  type SettingsProfileGroup,
} from "@/lib/settings/screen";
import { useI18n } from "@/i18n/provider";
import type { Messages } from "@/i18n/messages";
import type { RuntimeProviderCatalog } from "@/types/runtime-catalog";
import type {
  CredentialStatus,
  RuntimeProfile,
} from "@/types/runtime-settings";
import type { SettingsProfileView } from "@/types/settings-api";

type LoadState<T> =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly value: T }
  | { readonly status: "error"; readonly code: SettingsFailureCode };

async function loadCatalog(): Promise<LoadState<RuntimeProviderCatalog>> {
  const result = await requestSettingsJson("/api/settings/providers");

  if (!result.ok) {
    return { status: "error", code: result.code };
  }

  const catalog = narrowCatalogResponse(result.body);

  return catalog === null
    ? { status: "error", code: "unexpected" }
    : { status: "ready", value: catalog };
}

async function loadProfiles(): Promise<LoadState<readonly SettingsProfileView[]>> {
  const result = await requestSettingsJson("/api/settings/profiles");

  if (!result.ok) {
    return { status: "error", code: result.code };
  }

  const profiles = narrowProfilesResponse(result.body);

  return profiles === null
    ? { status: "error", code: "unexpected" }
    : { status: "ready", value: profiles };
}

function statusVariant(
  status: CredentialStatus,
): "default" | "destructive" | "outline" {
  if (status === "missing") {
    return "destructive";
  }

  return status === "present" ? "default" : "outline";
}

function ProfileGroupCard({
  group,
  messages,
  canEdit,
  onEdit,
  onCredentialStatusChange,
  onProfileMissing,
}: {
  readonly group: SettingsProfileGroup;
  readonly messages: Messages;
  readonly canEdit: boolean;
  readonly onEdit: (profile: RuntimeProfile) => void;
  readonly onCredentialStatusChange: (
    apiKeyEnv: string,
    status: CredentialStatus,
  ) => void;
  readonly onProfileMissing: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span>{messages.settings.groups.apiKeyEnv}</span>
          <code
            dir="ltr"
            className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs"
          >
            {group.apiKeyEnv}
          </code>
          <Badge variant={statusVariant(group.credentialStatus)}>
            {messages.settings.status[group.credentialStatus]}
          </Badge>
        </CardTitle>
        <CardDescription>{messages.settings.status.presenceOnly}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="grid gap-2">
          {group.profiles.map((profile) => (
            <li
              key={profile.id}
              className="rounded-lg border border-border p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{profile.label}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {profile.providerName}
                    <span aria-hidden="true"> / </span>
                    <span dir="ltr" className="font-mono">
                      {profile.model}
                    </span>
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onEdit(profile)}
                  disabled={!canEdit}
                >
                  {messages.settings.actions.edit}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <CredentialPanel
          group={group}
          onStatusChange={onCredentialStatusChange}
          onProfileMissing={onProfileMissing}
        />
        <p className="text-sm text-muted-foreground">
          {messages.settings.groups.sharedKey}
        </p>
        <p className="text-sm text-muted-foreground">
          {messages.settings.groups.profileCount}: {group.profiles.length}
        </p>
      </CardContent>
    </Card>
  );
}

export function SettingsScreen() {
  const { messages } = useI18n();
  const [catalogState, setCatalogState] = useState<
    LoadState<RuntimeProviderCatalog>
  >({ status: "loading" });
  const [profilesState, setProfilesState] = useState<
    LoadState<readonly SettingsProfileView[]>
  >({ status: "loading" });
  const [catalogKey, setCatalogKey] = useState(0);
  const [profilesKey, setProfilesKey] = useState(0);
  const [editingProfile, setEditingProfile] = useState<RuntimeProfile | null>(
    null,
  );
  const [feedback, setFeedback] = useState<"created" | "updated" | null>(null);
  const [formVersion, setFormVersion] = useState(0);

  useEffect(() => {
    let active = true;

    void loadCatalog().then((state) => {
      if (active) {
        setCatalogState(state);
      }
    });

    return () => {
      active = false;
    };
  }, [catalogKey]);

  useEffect(() => {
    let active = true;

    void loadProfiles().then((state) => {
      if (active) {
        setProfilesState(state);
      }
    });

    return () => {
      active = false;
    };
  }, [profilesKey]);

  const groups =
    profilesState.status === "ready"
      ? groupProfilesByApiKeyEnv(profilesState.value)
      : [];
  const isLoading =
    catalogState.status === "loading" || profilesState.status === "loading";
  const catalog =
    catalogState.status === "ready" ? catalogState.value : null;
  const canEdit = catalogState.status === "ready";

  function refresh() {
    setCatalogState({ status: "loading" });
    setProfilesState({ status: "loading" });
    setCatalogKey((current) => current + 1);
    setProfilesKey((current) => current + 1);
  }

  function reloadProfiles() {
    setProfilesState({ status: "loading" });
    setProfilesKey((current) => current + 1);
  }

  function reloadCatalog() {
    setCatalogState({ status: "loading" });
    setCatalogKey((current) => current + 1);
  }

  function handleSaved(mode: "created" | "updated") {
    setEditingProfile(null);
    setFeedback(mode);
    setFormVersion((current) => current + 1);
    reloadProfiles();
  }

  function handleProfileMissing() {
    setEditingProfile(null);
    reloadProfiles();
  }

  function handleCatalogRefresh() {
    reloadCatalog();
    reloadProfiles();
  }

  function handleEdit(profile: RuntimeProfile) {
    setFeedback(null);
    setEditingProfile(profile);
  }

  function handleCredentialStatusChange(
    apiKeyEnv: string,
    status: CredentialStatus,
  ) {
    setProfilesState((current) => {
      if (current.status !== "ready") {
        return current;
      }

      return {
        status: "ready",
        value: current.value.map((view) =>
          view.profile.apiKeyEnv === apiKeyEnv
            ? { ...view, credentialStatus: status }
            : view,
        ),
      };
    });
  }

  return (
    <section className="mt-10 space-y-4" aria-labelledby="settings-profiles">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="settings-profiles" className="text-lg font-semibold">
          {messages.settings.sections.profiles}
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={isLoading}
        >
          {messages.settings.refresh}
        </Button>
      </div>

      {feedback !== null ? (
        <Alert role="status" aria-live="polite">
          <AlertTitle>
            {feedback === "created"
              ? messages.settings.feedback.profileCreated
              : messages.settings.feedback.profileUpdated}
          </AlertTitle>
        </Alert>
      ) : null}

      {catalogState.status === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>{messages.settings.notices.catalogUnavailable}</AlertTitle>
          <AlertDescription>
            <p>{messages.settings.errors[catalogState.code]}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={refresh}
            >
              {messages.settings.retry}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {profilesState.status === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>{messages.settings.notices.profilesUnavailable}</AlertTitle>
          <AlertDescription>
            <p>{messages.settings.errors[profilesState.code]}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={refresh}
            >
              {messages.settings.retry}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {isLoading ? (
        <div role="status" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {messages.settings.loading}
          </p>
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : (
        <>
          <ProfileForm
            key={`${editingProfile?.id ?? "create"}-${formVersion}`}
            catalog={catalog}
            editingProfile={editingProfile}
            onSaved={handleSaved}
            onCancelEdit={() => setEditingProfile(null)}
            onProfileMissing={handleProfileMissing}
            onCatalogRefresh={handleCatalogRefresh}
          />

          {profilesState.status === "ready" && groups.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{messages.settings.emptyProfiles}</CardTitle>
              </CardHeader>
            </Card>
          ) : null}

          {groups.map((group) => (
            <ProfileGroupCard
              key={group.apiKeyEnv}
              group={group}
              messages={messages}
              canEdit={canEdit}
              onEdit={handleEdit}
              onCredentialStatusChange={handleCredentialStatusChange}
              onProfileMissing={handleProfileMissing}
            />
          ))}
        </>
      )}
    </section>
  );
}
