import { randomUUID } from "node:crypto";
import type { RuntimeProfilePersistence } from "../../types/persistence";
import type {
  RuntimeProviderCatalog,
  RuntimeProviderCatalogEntry,
} from "../../types/runtime-catalog";
import {
  validateRuntimeProfile,
  type CredentialStatus,
  type CredentialStore,
  type RuntimeProfile,
} from "../../types/runtime-settings";
import type {
  SettingsErrorCode,
  SettingsErrorField,
  SettingsProfileView,
} from "../../types/settings-api";
import { CredentialStoreError } from "../runtime/reasonix/env-file-store";
import { WorkflowRecordError } from "../workflow/persistence-errors";

export type { SettingsErrorCode, SettingsErrorField, SettingsProfileView };

const MESSAGES: Record<SettingsErrorCode, string> = {
  invalid_request: "The settings request is invalid.",
  invalid_json: "The request body must be a JSON object.",
  unsupported_media_type: "The request body must be JSON.",
  invalid_secret: "The credential format is invalid.",
  profile_not_found: "The runtime profile was not found.",
  provider_unknown: "The selected provider is not available.",
  model_unknown: "The selected model is not available for the provider.",
  api_key_env_unknown:
    "The provider does not report an API-key environment name.",
  catalog_unavailable: "The Reasonix provider catalog is unavailable.",
  credential_path_rejected: "The Reasonix home directory cannot be used.",
  credential_file_invalid: "The Reasonix credential file is malformed.",
  credential_conflict:
    "The Reasonix credential file changed during the write.",
  credential_locked:
    "The Reasonix credential file is locked by another writer.",
  credential_unavailable: "The Reasonix credential file is unavailable.",
  persistence_error: "The runtime profile store is unavailable.",
};

/**
 * A typed settings failure. The message is always generic; upstream error
 * messages, file paths, catalog output, and secrets are never attached.
 */
export class SettingsError extends Error {
  readonly code: SettingsErrorCode;
  readonly fields?: readonly SettingsErrorField[];

  constructor(
    code: SettingsErrorCode,
    fields?: readonly SettingsErrorField[],
  ) {
    super(MESSAGES[code]);
    this.name = "SettingsError";
    this.code = code;

    if (fields !== undefined) {
      this.fields = fields;
    }
  }
}

export interface SettingsServiceDeps {
  readonly profiles: RuntimeProfilePersistence;
  readonly credentials: CredentialStore;
  readonly loadCatalog: () => Promise<RuntimeProviderCatalog>;
  readonly now?: () => string;
  readonly newId?: () => string;
}

export interface SettingsService {
  loadCatalog(): Promise<RuntimeProviderCatalog>;
  listProfiles(): Promise<readonly SettingsProfileView[]>;
  createProfile(input: unknown): Promise<RuntimeProfile>;
  updateProfile(id: string, input: unknown): Promise<RuntimeProfile>;
  getCredentialStatus(id: string): Promise<CredentialStatus>;
  setCredential(id: string, input: unknown): Promise<CredentialStatus>;
  removeCredential(id: string): Promise<CredentialStatus>;
}

interface ProfileInput {
  readonly label: string;
  readonly providerName: string;
  readonly model: string;
}

interface CatalogSelection {
  readonly providerName: string;
  readonly model: string;
  readonly apiKeyEnv: string;
}

const PROFILE_FIELDS = ["label", "providerName", "model"] as const;
const PROFILE_FIELD_SET = new Set<string>(PROFILE_FIELDS);
const CREDENTIAL_FIELD = "secret";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function extraFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): SettingsErrorField[] {
  return Object.keys(value)
    .filter((field) => !allowed.has(field))
    .map((field) => ({ field, message: "is not allowed" }));
}

function parseProfileInput(value: unknown): ProfileInput {
  if (!isRecord(value)) {
    throw new SettingsError("invalid_request", [
      { field: "body", message: "must be an object" },
    ]);
  }

  const fields = extraFields(value, PROFILE_FIELD_SET);
  const label = value.label;
  const providerName = value.providerName;
  const model = value.model;

  if (!isNonEmptyString(label)) {
    fields.push({ field: "label", message: "must be a non-empty string" });
  }

  if (!isNonEmptyString(providerName)) {
    fields.push({
      field: "providerName",
      message: "must be a non-empty string",
    });
  }

  if (!isNonEmptyString(model)) {
    fields.push({ field: "model", message: "must be a non-empty string" });
  }

  if (fields.length > 0) {
    throw new SettingsError("invalid_request", fields);
  }

  return {
    label: label as string,
    providerName: providerName as string,
    model: model as string,
  };
}

function parseSecretInput(value: unknown): string {
  if (!isRecord(value)) {
    throw new SettingsError("invalid_request", [
      { field: "body", message: "must be an object" },
    ]);
  }

  const fields = extraFields(value, new Set([CREDENTIAL_FIELD]));
  const secret = value[CREDENTIAL_FIELD];

  if (!isNonEmptyString(secret)) {
    fields.push({ field: CREDENTIAL_FIELD, message: "must be a non-empty string" });
  }

  if (fields.length > 0) {
    throw new SettingsError("invalid_request", fields);
  }

  return secret as string;
}

function credentialFailure(error: unknown): SettingsError {
  if (error instanceof CredentialStoreError) {
    switch (error.code) {
      case "invalid_secret":
        return new SettingsError("invalid_secret");
      case "unsafe_path":
        return new SettingsError("credential_path_rejected");
      case "parse":
        return new SettingsError("credential_file_invalid");
      case "conflict":
        return new SettingsError("credential_conflict");
      case "lock":
        return new SettingsError("credential_locked");
      case "invalid_ref":
      case "io":
        return new SettingsError("credential_unavailable");
    }
  }

  return new SettingsError("credential_unavailable");
}

function requireSelection(
  catalog: RuntimeProviderCatalog,
  input: ProfileInput,
): CatalogSelection {
  const provider: RuntimeProviderCatalogEntry | undefined =
    catalog.providers.find((entry) => entry.name === input.providerName);

  if (provider === undefined) {
    throw new SettingsError("provider_unknown");
  }

  if (!provider.models.includes(input.model)) {
    throw new SettingsError("model_unknown");
  }

  if (provider.apiKeyEnv === null) {
    throw new SettingsError("api_key_env_unknown");
  }

  return {
    providerName: provider.name,
    model: input.model,
    apiKeyEnv: provider.apiKeyEnv,
  };
}

function assertValidProfile(profile: RuntimeProfile): void {
  const errors = validateRuntimeProfile(profile);

  if (errors.length > 0) {
    throw new SettingsError("invalid_request", errors);
  }
}

export function createSettingsService(
  deps: SettingsServiceDeps,
): SettingsService {
  const now = deps.now ?? (() => new Date().toISOString());
  const newId = deps.newId ?? (() => randomUUID());

  async function loadCatalog(): Promise<RuntimeProviderCatalog> {
    try {
      return await deps.loadCatalog();
    } catch {
      throw new SettingsError("catalog_unavailable");
    }
  }

  async function requireProfile(id: string): Promise<RuntimeProfile> {
    let profile: RuntimeProfile | null;

    try {
      profile = await deps.profiles.getRuntimeProfile(id);
    } catch {
      throw new SettingsError("persistence_error");
    }

    if (profile === null) {
      throw new SettingsError("profile_not_found");
    }

    return profile;
  }

  async function statusFor(profile: RuntimeProfile): Promise<CredentialStatus> {
    try {
      return await deps.credentials.status(profile.credentialRef);
    } catch (error) {
      throw credentialFailure(error);
    }
  }

  async function listProfiles(): Promise<readonly SettingsProfileView[]> {
    let profiles: readonly RuntimeProfile[];

    try {
      profiles = await deps.profiles.listRuntimeProfiles();
    } catch {
      throw new SettingsError("persistence_error");
    }

    const statuses = new Map<string, CredentialStatus>();
    const views: SettingsProfileView[] = [];

    for (const profile of profiles) {
      let status = statuses.get(profile.apiKeyEnv);

      if (status === undefined) {
        status = await statusFor(profile);
        statuses.set(profile.apiKeyEnv, status);
      }

      views.push({ profile, credentialStatus: status });
    }

    return views;
  }

  async function createProfile(input: unknown): Promise<RuntimeProfile> {
    const parsed = parseProfileInput(input);
    const catalog = await loadCatalog();
    const selection = requireSelection(catalog, parsed);
    const timestamp = now();
    const profile: RuntimeProfile = {
      id: newId(),
      label: parsed.label,
      adapterId: "reasonix",
      providerName: selection.providerName,
      model: selection.model,
      apiKeyEnv: selection.apiKeyEnv,
      credentialRef: {
        kind: "reasonix-env",
        providerName: selection.providerName,
        apiKeyEnv: selection.apiKeyEnv,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    assertValidProfile(profile);

    try {
      await deps.profiles.createRuntimeProfile(profile);
    } catch {
      throw new SettingsError("persistence_error");
    }

    return profile;
  }

  async function updateProfile(
    id: string,
    input: unknown,
  ): Promise<RuntimeProfile> {
    const parsed = parseProfileInput(input);
    const existing = await requireProfile(id);
    const catalog = await loadCatalog();
    const selection = requireSelection(catalog, parsed);
    const profile: RuntimeProfile = {
      ...existing,
      label: parsed.label,
      providerName: selection.providerName,
      model: selection.model,
      apiKeyEnv: selection.apiKeyEnv,
      credentialRef: {
        kind: "reasonix-env",
        providerName: selection.providerName,
        apiKeyEnv: selection.apiKeyEnv,
      },
      updatedAt: now(),
    };

    assertValidProfile(profile);

    try {
      await deps.profiles.updateRuntimeProfile(profile);
    } catch (error) {
      if (
        error instanceof WorkflowRecordError &&
        error.operation === "update"
      ) {
        throw new SettingsError("profile_not_found");
      }

      throw new SettingsError("persistence_error");
    }

    return profile;
  }

  async function getCredentialStatus(id: string): Promise<CredentialStatus> {
    return statusFor(await requireProfile(id));
  }

  async function setCredential(
    id: string,
    input: unknown,
  ): Promise<CredentialStatus> {
    const profile = await requireProfile(id);
    const secret = parseSecretInput(input);

    try {
      await deps.credentials.set(profile.credentialRef, secret);
    } catch (error) {
      throw credentialFailure(error);
    }

    return statusFor(profile);
  }

  async function removeCredential(id: string): Promise<CredentialStatus> {
    const profile = await requireProfile(id);

    try {
      await deps.credentials.remove(profile.credentialRef);
    } catch (error) {
      throw credentialFailure(error);
    }

    return statusFor(profile);
  }

  return {
    loadCatalog,
    listProfiles,
    createProfile,
    updateProfile,
    getCredentialStatus,
    setCredential,
    removeCredential,
  };
}
