"use client";

import { useState, type FormEvent } from "react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestSettingsJson } from "@/lib/settings/client";
import {
  narrowCredentialStatusResponse,
  type SettingsFailureCode,
  type SettingsProfileGroup,
} from "@/lib/settings/screen";
import { useI18n } from "@/i18n/provider";
import type { CredentialStatus } from "@/types/runtime-settings";

export interface CredentialPanelProps {
  readonly group: SettingsProfileGroup;
  readonly onStatusChange: (
    apiKeyEnv: string,
    status: CredentialStatus,
  ) => void;
  readonly onProfileMissing: () => void;
}

export function CredentialPanel({
  group,
  onStatusChange,
  onProfileMissing,
}: CredentialPanelProps) {
  const { messages } = useI18n();
  const [secret, setSecret] = useState("");
  const [pending, setPending] = useState<"save" | "remove" | null>(null);
  const [errorCode, setErrorCode] = useState<SettingsFailureCode | null>(null);
  const [feedback, setFeedback] = useState<"saved" | "removed" | null>(null);
  const profileId = group.profiles[0]?.id;
  const inputId = `credential-${group.apiKeyEnv}`;
  const labelId = `credential-label-${group.apiKeyEnv}`;
  const envId = `credential-env-${group.apiKeyEnv}`;

  if (profileId === undefined) {
    return null;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pending !== null || profileId === undefined) {
      return;
    }

    const trimmed = secret.trim();

    if (trimmed === "") {
      setErrorCode("invalid_request");
      return;
    }

    setPending("save");
    setErrorCode(null);
    setFeedback(null);

    const result = await requestSettingsJson(
      `/api/settings/profiles/${profileId}/credential`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret: trimmed }),
      },
    );

    setSecret("");
    setPending(null);

    if (!result.ok) {
      setErrorCode(result.code);

      if (result.code === "profile_not_found") {
        onProfileMissing();
      }

      return;
    }

    const status = narrowCredentialStatusResponse(result.body);

    if (status === null) {
      setErrorCode("unexpected");
      return;
    }

    onStatusChange(group.apiKeyEnv, status);
    setFeedback("saved");
  }

  async function remove() {
    if (pending !== null || profileId === undefined) {
      return;
    }

    setPending("remove");
    setErrorCode(null);
    setFeedback(null);

    const result = await requestSettingsJson(
      `/api/settings/profiles/${profileId}/credential`,
      { method: "DELETE" },
    );

    setPending(null);

    if (!result.ok) {
      setErrorCode(result.code);

      if (result.code === "profile_not_found") {
        onProfileMissing();
      }

      return;
    }

    const status = narrowCredentialStatusResponse(result.body);

    if (status === null) {
      setErrorCode("unexpected");
      return;
    }

    onStatusChange(group.apiKeyEnv, status);
    setFeedback("removed");
  }

  const errorMessage =
    errorCode === null
      ? null
      : errorCode === "invalid_request" && secret.trim() === ""
        ? messages.settings.fields.apiKeyRequired
        : messages.settings.errors[errorCode];

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <form onSubmit={save} className="flex flex-wrap items-end gap-2">
        <div className="grid min-w-56 flex-1 gap-2">
          <Label id={labelId} htmlFor={inputId}>
            {messages.settings.fields.apiKey}
            <code
              id={envId}
              dir="ltr"
              className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs"
            >
              {group.apiKeyEnv}
            </code>
          </Label>
          <Input
            id={inputId}
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            autoComplete="new-password"
            spellCheck={false}
            dir="ltr"
            disabled={pending !== null}
            aria-labelledby={`${labelId} ${envId}`}
            aria-describedby={`${inputId}-help`}
            aria-invalid={
              errorCode === "invalid_request" ||
              errorCode === "invalid_secret" ||
              undefined
            }
          />
          <p
            id={`${inputId}-help`}
            className="text-xs text-muted-foreground"
          >
            {messages.settings.fields.apiKeyHelp}
          </p>
        </div>
        <Button
          type="submit"
          size="sm"
          disabled={pending !== null || secret.trim() === ""}
        >
          {pending === "save"
            ? messages.settings.actions.savingKey
            : messages.settings.actions.setKey}
        </Button>
        {group.credentialStatus !== "missing" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={remove}
            disabled={pending !== null}
          >
            {pending === "remove"
              ? messages.settings.actions.removingKey
              : messages.settings.actions.removeKey}
          </Button>
        ) : null}
      </form>

      {errorMessage !== null ? (
        <Alert variant="destructive">
          <AlertTitle>{errorMessage}</AlertTitle>
        </Alert>
      ) : null}

      {feedback !== null ? (
        <Alert role="status" aria-live="polite">
          <AlertTitle>
            {feedback === "saved"
              ? messages.settings.feedback.credentialSaved
              : messages.settings.feedback.credentialRemoved}
          </AlertTitle>
        </Alert>
      ) : null}
    </div>
  );
}
