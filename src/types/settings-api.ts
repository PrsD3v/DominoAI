import type { RuntimeProviderCatalog } from "./runtime-catalog";
import type {
  ConnectionTestResult,
  CredentialStatus,
  RuntimeProfile,
} from "./runtime-settings";

/** Stable, non-secret error codes shared by the settings service and its UI. */
export const SETTINGS_ERROR_CODES = [
  "invalid_request",
  "invalid_json",
  "unsupported_media_type",
  "invalid_secret",
  "profile_not_found",
  "project_not_found",
  "provider_unknown",
  "model_unknown",
  "api_key_env_unknown",
  "catalog_unavailable",
  "credential_path_rejected",
  "credential_file_invalid",
  "credential_conflict",
  "credential_locked",
  "credential_unavailable",
  "persistence_error",
] as const;

export type SettingsErrorCode = (typeof SETTINGS_ERROR_CODES)[number];

/** One field-level validation problem. It never describes a secret value. */
export interface SettingsErrorField {
  readonly field: string;
  readonly message: string;
}

/** A profile plus its credential presence. No secret is part of this view. */
export interface SettingsProfileView {
  readonly profile: RuntimeProfile;
  readonly credentialStatus: CredentialStatus;
}

export interface SettingsCatalogResponse {
  readonly catalog: RuntimeProviderCatalog;
}

export interface SettingsProfilesResponse {
  readonly profiles: readonly SettingsProfileView[];
}

export interface SettingsProfileResponse {
  readonly profile: RuntimeProfile;
}

export interface SettingsProjectDefaultProfileResponse {
  readonly projectId: string;
  readonly defaultRuntimeProfileId: string | null;
}

export interface SettingsCredentialStatusResponse {
  readonly status: CredentialStatus;
}

export interface SettingsConnectionTestResponse {
  readonly result: ConnectionTestResult;
}

export interface SettingsErrorBody {
  readonly error: {
    readonly code: SettingsErrorCode;
    readonly message: string;
    readonly fields?: readonly SettingsErrorField[];
  };
}
