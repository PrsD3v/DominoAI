import type {
  ApiKeyEnvName,
  CredentialStatus,
  RuntimeModelName,
  RuntimeProviderName,
} from "./runtime-settings";

/**
 * One provider reported by the installed Reasonix metadata.
 * This is discovery only; it is not proof that the provider is usable.
 */
export interface RuntimeProviderCatalogEntry {
  readonly name: RuntimeProviderName;
  readonly models: readonly RuntimeModelName[];
  readonly apiKeyEnv: ApiKeyEnvName | null;
  /**
   * Presence only. "present" never proves that the credential is valid.
   * "unknown" means Reasonix did not report key presence.
   */
  readonly credentialStatus: CredentialStatus;
}

/** A configured default that resolves to a discovered provider and model. */
export interface RuntimeDefaultSelection {
  readonly providerName: RuntimeProviderName;
  readonly model: RuntimeModelName;
}

/**
 * Read-only, non-secret provider/model metadata from `reasonix doctor --json`.
 * Discovery does not prove connection validity, and no credential value is part
 * of this contract.
 */
export interface RuntimeProviderCatalog {
  readonly source: "reasonix-doctor";
  readonly reasonixVersion: string | null;
  readonly providers: readonly RuntimeProviderCatalogEntry[];
  /** Raw configured default, for example "deepseek/deepseek-flash". */
  readonly configuredDefaultModel: string | null;
  /** Present only when the configured default matches discovered metadata. */
  readonly defaultSelection: RuntimeDefaultSelection | null;
}
