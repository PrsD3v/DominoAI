import type {
  RuntimeDefaultSelection,
  RuntimeProviderCatalog,
  RuntimeProviderCatalogEntry,
} from "../../types/runtime-catalog";
import type {
  CredentialStatus,
  RuntimeProfile,
} from "../../types/runtime-settings";
import { isRuntimeProfile } from "../../types/runtime-settings";
import {
  SETTINGS_ERROR_CODES,
  type SettingsErrorCode,
  type SettingsProfileView,
} from "../../types/settings-api";

export type SettingsFailureCode = SettingsErrorCode | "network" | "unexpected";

export type SettingsFieldName =
  | "label"
  | "providerName"
  | "model"
  | "secret"
  | "body";

export interface SettingsProfileGroup {
  readonly apiKeyEnv: string;
  readonly credentialStatus: CredentialStatus;
  readonly profiles: readonly RuntimeProfile[];
}

export interface FormSelection {
  readonly providerName: string | null;
  readonly model: string | null;
  readonly unavailable: boolean;
}

export type SelectableProvider = RuntimeProviderCatalogEntry & {
  readonly apiKeyEnv: string;
};

const CREDENTIAL_STATUSES: readonly CredentialStatus[] = [
  "missing",
  "present",
  "unknown",
];

const SETTINGS_ERROR_CODE_SET = new Set<string>(SETTINGS_ERROR_CODES);
const SETTINGS_FIELD_NAMES = new Set<string>([
  "label",
  "providerName",
  "model",
  "secret",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isCredentialStatus(value: unknown): value is CredentialStatus {
  return (
    typeof value === "string" &&
    (CREDENTIAL_STATUSES as readonly string[]).includes(value)
  );
}

export function groupProfilesByApiKeyEnv(
  views: readonly SettingsProfileView[],
): readonly SettingsProfileGroup[] {
  const groups = new Map<
    string,
    { credentialStatus: CredentialStatus; profiles: RuntimeProfile[] }
  >();

  for (const view of views) {
    const existing = groups.get(view.profile.apiKeyEnv);

    if (existing === undefined) {
      groups.set(view.profile.apiKeyEnv, {
        credentialStatus: view.credentialStatus,
        profiles: [view.profile],
      });
      continue;
    }

    existing.profiles.push(view.profile);

    if (existing.credentialStatus !== view.credentialStatus) {
      existing.credentialStatus = "unknown";
    }
  }

  return [...groups.entries()].map(([apiKeyEnv, group]) => ({
    apiKeyEnv,
    credentialStatus: group.credentialStatus,
    profiles: group.profiles,
  }));
}

function isSelectableProvider(
  provider: RuntimeProviderCatalogEntry,
): provider is SelectableProvider {
  return provider.apiKeyEnv !== null;
}

export function selectableProviders(
  catalog: RuntimeProviderCatalog,
): readonly SelectableProvider[] {
  return catalog.providers.filter(isSelectableProvider);
}

export function modelsForProvider(
  catalog: RuntimeProviderCatalog,
  providerName: string | null,
): readonly string[] {
  if (providerName === null) {
    return [];
  }

  return (
    selectableProviders(catalog).find(
      (provider) => provider.name === providerName,
    )?.models ?? []
  );
}

export function modelAfterProviderChange(
  catalog: RuntimeProviderCatalog,
  providerName: string,
): string | null {
  return modelsForProvider(catalog, providerName)[0] ?? null;
}

export function initialFormSelection(
  catalog: RuntimeProviderCatalog,
): FormSelection {
  const providers = selectableProviders(catalog);

  if (providers.length === 0) {
    return { providerName: null, model: null, unavailable: false };
  }

  const preferred = catalog.defaultSelection;
  const preferredProvider =
    preferred === null
      ? undefined
      : providers.find((provider) => provider.name === preferred.providerName);

  if (
    preferred !== null &&
    preferredProvider !== undefined &&
    preferredProvider.models.includes(preferred.model)
  ) {
    return {
      providerName: preferredProvider.name,
      model: preferred.model,
      unavailable: false,
    };
  }

  const first = providers[0];

  return {
    providerName: first.name,
    model: first.models[0] ?? null,
    unavailable: false,
  };
}

export function formSelectionFromProfile(
  catalog: RuntimeProviderCatalog,
  profile: RuntimeProfile,
): FormSelection {
  const provider = selectableProviders(catalog).find(
    (entry) => entry.name === profile.providerName,
  );

  if (provider === undefined) {
    return { providerName: null, model: null, unavailable: true };
  }

  if (!provider.models.includes(profile.model)) {
    return { providerName: provider.name, model: null, unavailable: true };
  }

  return { providerName: provider.name, model: profile.model, unavailable: false };
}

function readProvider(value: unknown): RuntimeProviderCatalogEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.name !== "string" || !isNullableString(value.apiKeyEnv)) {
    return null;
  }

  if (!isStringArray(value.models) || !isCredentialStatus(value.credentialStatus)) {
    return null;
  }

  return {
    name: value.name,
    models: value.models,
    apiKeyEnv: value.apiKeyEnv,
    credentialStatus: value.credentialStatus,
  };
}

function readDefaultSelection(
  value: unknown,
): RuntimeDefaultSelection | null | undefined {
  if (value === null) {
    return null;
  }

  if (
    !isRecord(value) ||
    typeof value.providerName !== "string" ||
    typeof value.model !== "string"
  ) {
    return undefined;
  }

  return { providerName: value.providerName, model: value.model };
}

export function narrowCatalogResponse(
  value: unknown,
): RuntimeProviderCatalog | null {
  if (!isRecord(value) || !isRecord(value.catalog)) {
    return null;
  }

  const catalog = value.catalog;

  if (
    catalog.source !== "reasonix-doctor" ||
    !isNullableString(catalog.reasonixVersion) ||
    !isNullableString(catalog.configuredDefaultModel) ||
    !Array.isArray(catalog.providers)
  ) {
    return null;
  }

  const providers: RuntimeProviderCatalogEntry[] = [];

  for (const entry of catalog.providers) {
    const provider = readProvider(entry);

    if (provider === null) {
      return null;
    }

    providers.push(provider);
  }

  let defaultSelection: RuntimeDefaultSelection | null;

  if (catalog.defaultSelection === null) {
    defaultSelection = null;
  } else {
    const selection = readDefaultSelection(catalog.defaultSelection);

    if (selection === undefined) {
      return null;
    }

    defaultSelection = selection;
  }

  return {
    source: "reasonix-doctor",
    reasonixVersion: catalog.reasonixVersion,
    providers,
    configuredDefaultModel: catalog.configuredDefaultModel,
    defaultSelection,
  };
}

export function narrowProfilesResponse(
  value: unknown,
): readonly SettingsProfileView[] | null {
  if (!isRecord(value) || !Array.isArray(value.profiles)) {
    return null;
  }

  const views: SettingsProfileView[] = [];

  for (const item of value.profiles) {
    if (
      !isRecord(item) ||
      !isRuntimeProfile(item.profile) ||
      !isCredentialStatus(item.credentialStatus)
    ) {
      return null;
    }

    views.push({
      profile: item.profile,
      credentialStatus: item.credentialStatus,
    });
  }

  return views;
}

export function narrowProfileResponse(value: unknown): RuntimeProfile | null {
  if (!isRecord(value) || !isRuntimeProfile(value.profile)) {
    return null;
  }

  return value.profile;
}

export function narrowCredentialStatusResponse(
  value: unknown,
): CredentialStatus | null {
  if (!isRecord(value) || !isCredentialStatus(value.status)) {
    return null;
  }

  return value.status;
}

export function parseSettingsFailure(
  status: number,
  body: unknown,
): SettingsFailureCode {
  if (status === 0) {
    return "network";
  }

  if (
    isRecord(body) &&
    isRecord(body.error) &&
    typeof body.error.code === "string" &&
    SETTINGS_ERROR_CODE_SET.has(body.error.code)
  ) {
    return body.error.code as SettingsErrorCode;
  }

  return "unexpected";
}

export function parseSettingsFieldErrors(
  body: unknown,
): readonly SettingsFieldName[] {
  if (
    !isRecord(body) ||
    !isRecord(body.error) ||
    !Array.isArray(body.error.fields)
  ) {
    return [];
  }

  const fields = new Set<SettingsFieldName>();

  for (const entry of body.error.fields) {
    if (
      isRecord(entry) &&
      typeof entry.field === "string" &&
      SETTINGS_FIELD_NAMES.has(entry.field)
    ) {
      fields.add(entry.field as SettingsFieldName);
    } else {
      fields.add("body");
    }
  }

  return [...fields];
}
