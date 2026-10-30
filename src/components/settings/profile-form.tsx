"use client";

import { DirectionProvider } from "@base-ui/react/direction-provider";
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
import { requestSettingsJson } from "@/lib/settings/client";
import {
  formSelectionFromProfile,
  initialFormSelection,
  modelAfterProviderChange,
  modelsForProvider,
  narrowProfileResponse,
  parseSettingsFieldErrors,
  selectableProviders,
  type SettingsFailureCode,
  type SettingsFieldName,
} from "@/lib/settings/screen";
import { useI18n } from "@/i18n/provider";
import type { Messages } from "@/i18n/messages";
import type { RuntimeProviderCatalog } from "@/types/runtime-catalog";
import type { RuntimeProfile } from "@/types/runtime-settings";

export interface ProfileFormProps {
  readonly catalog: RuntimeProviderCatalog | null;
  readonly editingProfile: RuntimeProfile | null;
  readonly onSaved: (mode: "created" | "updated") => void;
  readonly onCancelEdit: () => void;
  readonly onProfileMissing: () => void;
  readonly onCatalogRefresh: () => void;
}

function fieldMessage(
  messages: Messages,
  field: SettingsFieldName,
): string | null {
  switch (field) {
    case "label":
      return messages.settings.fields.labelRequired;
    case "providerName":
      return messages.settings.fields.providerRequired;
    case "model":
      return messages.settings.fields.modelRequired;
    case "secret":
      return messages.settings.fields.apiKeyRequired;
    default:
      return null;
  }
}

function ProfileFormFields({
  catalog,
  editingProfile,
  onSaved,
  onCancelEdit,
  onProfileMissing,
  onCatalogRefresh,
}: ProfileFormProps & { readonly catalog: RuntimeProviderCatalog }) {
  const { dir, messages } = useI18n();
  const providers = selectableProviders(catalog);
  const selection =
    editingProfile === null
      ? initialFormSelection(catalog)
      : formSelectionFromProfile(catalog, editingProfile);
  const [label, setLabel] = useState(editingProfile?.label ?? "");
  const [providerName, setProviderName] = useState<string | null>(
    selection.providerName,
  );
  const [model, setModel] = useState<string | null>(selection.model);
  const [submitting, setSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<SettingsFailureCode | null>(null);
  const [fieldErrors, setFieldErrors] = useState<readonly SettingsFieldName[]>(
    [],
  );
  const errorRef = useRef<HTMLDivElement>(null);
  const isEditing = editingProfile !== null;
  const models = modelsForProvider(catalog, providerName);
  const noProviders = providers.length === 0;
  const providerAvailable = providers.some(
    (provider) => provider.name === providerName,
  );
  const modelAvailable = model !== null && models.includes(model);
  const storedSelectionUnavailable =
    isEditing && (!providerAvailable || !modelAvailable);
  const canSubmit =
    !submitting && !noProviders && providerAvailable && modelAvailable;

  useEffect(() => {
    if (errorCode !== null) {
      errorRef.current?.focus();
    }
  }, [errorCode, fieldErrors]);

  function clearFieldError(field: SettingsFieldName) {
    setFieldErrors((current) => current.filter((entry) => entry !== field));
    setErrorCode((current) =>
      current === "invalid_request" ? null : current,
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitting) {
      return;
    }

    const trimmedLabel = label.trim();
    const clientErrors: SettingsFieldName[] = [];

    if (trimmedLabel === "") {
      clientErrors.push("label");
    }

    if (providerName === null) {
      clientErrors.push("providerName");
    }

    if (model === null) {
      clientErrors.push("model");
    }

    if (clientErrors.length > 0) {
      setErrorCode("invalid_request");
      setFieldErrors(clientErrors);
      return;
    }

    setSubmitting(true);
    setErrorCode(null);
    setFieldErrors([]);

    const result = await requestSettingsJson(
      editingProfile === null
        ? "/api/settings/profiles"
        : `/api/settings/profiles/${editingProfile.id}`,
      {
        method: editingProfile === null ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: trimmedLabel,
          providerName,
          model,
        }),
      },
    );

    setSubmitting(false);

    if (!result.ok) {
      setErrorCode(result.code);
      setFieldErrors(parseSettingsFieldErrors(result.body));

      if (result.code === "profile_not_found") {
        onProfileMissing();
        return;
      }

      if (
        result.code === "provider_unknown" ||
        result.code === "model_unknown" ||
        result.code === "api_key_env_unknown" ||
        result.code === "catalog_unavailable"
      ) {
        onCatalogRefresh();
      }

      return;
    }

    if (narrowProfileResponse(result.body) === null) {
      setErrorCode("unexpected");
      return;
    }

    onSaved(editingProfile === null ? "created" : "updated");
  }

  const hasFieldMessages = fieldErrors.some(
    (field) => fieldMessage(messages, field) !== null,
  );

  return (
    <DirectionProvider direction={dir}>
      <Card>
        <CardHeader>
          <CardTitle>
            {isEditing
              ? messages.settings.sections.editProfile
              : messages.settings.sections.createProfile}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} noValidate className="grid gap-4">
            {errorCode !== null ? (
              <div
                ref={errorRef}
                id="profile-error-summary"
                tabIndex={-1}
                className="outline-none"
              >
                <Alert variant="destructive">
                  <AlertTitle>{messages.settings.errors[errorCode]}</AlertTitle>
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

            {storedSelectionUnavailable ? (
              <Alert>
                <AlertTitle>
                  {messages.settings.notices.selectionUnavailable}
                </AlertTitle>
              </Alert>
            ) : null}

            {noProviders ? (
              <Alert>
                <AlertTitle>
                  {messages.settings.notices.noSelectableProvider}
                </AlertTitle>
              </Alert>
            ) : null}

            <div className="grid gap-2">
              <Label htmlFor="profile-label">
                {messages.settings.fields.label}
              </Label>
              <Input
                id="profile-label"
                value={label}
                onChange={(event) => {
                  setLabel(event.target.value);
                  clearFieldError("label");
                }}
                disabled={submitting}
                required
                aria-invalid={fieldErrors.includes("label") || undefined}
                aria-describedby={
                  fieldErrors.includes("label")
                    ? "profile-label-help profile-error-summary"
                    : "profile-label-help"
                }
              />
              <p
                id="profile-label-help"
                className="text-xs text-muted-foreground"
              >
                {messages.settings.fields.labelHelp}
              </p>
            </div>

            <div className="grid gap-2">
              <Label
                id="profile-provider-label"
                htmlFor="profile-provider"
              >
                {messages.settings.fields.provider}
              </Label>
              <Select
                value={providerName}
                onValueChange={(value) => {
                  if (typeof value !== "string") {
                    return;
                  }

                  setProviderName(value);
                  setModel(modelAfterProviderChange(catalog, value));
                  clearFieldError("providerName");
                }}
                disabled={submitting || noProviders}
                required
              >
                <SelectTrigger
                  id="profile-provider"
                  className="w-full"
                  aria-labelledby="profile-provider-label"
                  aria-invalid={
                    fieldErrors.includes("providerName") || undefined
                  }
                  aria-describedby={
                    fieldErrors.includes("providerName")
                      ? "profile-error-summary"
                      : undefined
                  }
                >
                  <SelectValue
                    placeholder={messages.settings.fields.provider}
                  />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((provider) => (
                    <SelectItem key={provider.name} value={provider.name}>
                      {provider.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label id="profile-model-label" htmlFor="profile-model">
                {messages.settings.fields.model}
              </Label>
              <Select
                value={model}
                onValueChange={(value) => {
                  if (typeof value !== "string") {
                    return;
                  }

                  setModel(value);
                  clearFieldError("model");
                }}
                disabled={
                  submitting || providerName === null || models.length === 0
                }
                required
              >
                <SelectTrigger
                  id="profile-model"
                  className="w-full"
                  aria-labelledby="profile-model-label"
                  aria-invalid={fieldErrors.includes("model") || undefined}
                  aria-describedby={
                    fieldErrors.includes("model")
                      ? "profile-error-summary"
                      : undefined
                  }
                >
                  <SelectValue placeholder={messages.settings.fields.model} />
                </SelectTrigger>
                <SelectContent>
                  {models.map((entry) => (
                    <SelectItem key={entry} value={entry}>
                      {entry}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={!canSubmit}>
                {submitting
                  ? messages.settings.actions.saving
                  : isEditing
                    ? messages.settings.actions.save
                    : messages.settings.actions.create}
              </Button>
              {isEditing ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onCancelEdit}
                  disabled={submitting}
                >
                  {messages.settings.actions.cancel}
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>
    </DirectionProvider>
  );
}

export function ProfileForm(props: ProfileFormProps) {
  const { messages } = useI18n();

  if (props.catalog === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{messages.settings.sections.createProfile}</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertTitle>
              {messages.settings.notices.createUnavailable}
            </AlertTitle>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return <ProfileFormFields {...props} catalog={props.catalog} />;
}
