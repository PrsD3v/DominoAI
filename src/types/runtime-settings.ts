/** Stable identifier for a Domino runtime profile. */
export type RuntimeProfileId = string;

/** Runtime adapter supported by the MVP. Extend only when a later feature proves another adapter. */
export type RuntimeAdapterId = "reasonix";

/** Provider name as reported by the installed runtime. */
export type RuntimeProviderName = string;

/** Model identifier valid for the selected provider. */
export type RuntimeModelName = string;

/** Environment variable name that holds the provider key. */
export type ApiKeyEnvName = string;

/** Credential source supported by the MVP. */
export type CredentialKind = "reasonix-env";

/**
 * Reference to a runtime-owned credential entry.
 * It contains the provider and variable name, never the secret value.
 */
export interface CredentialRef {
  readonly kind: CredentialKind;
  readonly providerName: RuntimeProviderName;
  readonly apiKeyEnv: ApiKeyEnvName;
}

/**
 * Non-secret runtime settings.
 * The credential is referenced by name only; no key or secret belongs here.
 */
export interface RuntimeProfile {
  readonly id: RuntimeProfileId;
  readonly label: string;
  readonly adapterId: RuntimeAdapterId;
  readonly providerName: RuntimeProviderName;
  readonly model: RuntimeModelName;
  readonly apiKeyEnv: ApiKeyEnvName;
  readonly credentialRef: CredentialRef;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Presence of a credential. It never carries or returns a secret value. */
export type CredentialStatus = "missing" | "present" | "unknown";

/** Stable, non-secret failure codes for a runtime connection test. */
export const CONNECTION_TEST_FAILURE_CODES = [
  "credential_missing",
  "invalid_profile",
  "workspace_unavailable",
  "runtime_unavailable",
  "session_failed",
  "prompt_failed",
  "cancelled",
  "timeout",
] as const;

export type ConnectionTestFailureCode =
  (typeof CONNECTION_TEST_FAILURE_CODES)[number];

/**
 * Outcome of one connection test.
 * It never contains a credential, runtime message, path, or model output.
 */
export type ConnectionTestResult =
  | { readonly outcome: "succeeded" }
  | { readonly outcome: "failed"; readonly code: ConnectionTestFailureCode };

const CONNECTION_TEST_FAILURE_CODE_SET = new Set<string>(
  CONNECTION_TEST_FAILURE_CODES,
);

/** Runtime guard for a stable connection-test failure code. */
export function isConnectionTestFailureCode(
  value: unknown,
): value is ConnectionTestFailureCode {
  return (
    typeof value === "string" && CONNECTION_TEST_FAILURE_CODE_SET.has(value)
  );
}

/** Write-only credential operations. There is deliberately no read operation. */
export interface CredentialStore {
  status(ref: CredentialRef): Promise<CredentialStatus>;
  set(ref: CredentialRef, secret: string): Promise<void>;
  remove(ref: CredentialRef): Promise<void>;
}

/** One validation problem on a runtime settings contract. */
export interface RuntimeSettingsValidationError {
  readonly field: string;
  readonly message: string;
}

const PROFILE_FIELDS = new Set([
  "id",
  "label",
  "adapterId",
  "providerName",
  "model",
  "apiKeyEnv",
  "credentialRef",
  "createdAt",
  "updatedAt",
]);

const CREDENTIAL_REF_FIELDS = new Set([
  "kind",
  "providerName",
  "apiKeyEnv",
]);

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isTimestamp(value: unknown): value is string {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function extraFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): string[] {
  return Object.keys(value).filter((field) => !allowed.has(field));
}

function requireNonEmptyString(
  value: Record<string, unknown>,
  field: string,
  errors: RuntimeSettingsValidationError[],
): void {
  if (!isNonEmptyString(value[field])) {
    errors.push({ field, message: "must be a non-empty string" });
  }
}

function credentialRefErrors(
  value: unknown,
  prefix: string,
): RuntimeSettingsValidationError[] {
  const errors: RuntimeSettingsValidationError[] = [];

  if (!isRecord(value)) {
    errors.push({ field: prefix, message: "must be an object" });
    return errors;
  }

  for (const field of extraFields(value, CREDENTIAL_REF_FIELDS)) {
    errors.push({ field: `${prefix}.${field}`, message: "is not allowed" });
  }

  if (value.kind !== "reasonix-env") {
    errors.push({
      field: `${prefix}.kind`,
      message: 'must be "reasonix-env"',
    });
  }

  if (!isNonEmptyString(value.providerName)) {
    errors.push({
      field: `${prefix}.providerName`,
      message: "must be a non-empty string",
    });
  }

  if (
    !isNonEmptyString(value.apiKeyEnv) ||
    !ENV_NAME_PATTERN.test(value.apiKeyEnv)
  ) {
    errors.push({
      field: `${prefix}.apiKeyEnv`,
      message: "must be a valid environment variable name",
    });
  }

  return errors;
}

/** Validate a credential reference without reading or accepting a secret. */
export function validateCredentialRef(
  value: unknown,
): RuntimeSettingsValidationError[] {
  return credentialRefErrors(value, "credentialRef");
}

/** Validate the non-secret runtime profile shape. Unknown fields, including secret-like fields, are rejected. */
export function validateRuntimeProfile(
  value: unknown,
): RuntimeSettingsValidationError[] {
  if (!isRecord(value)) {
    return [{ field: "profile", message: "must be an object" }];
  }

  const errors: RuntimeSettingsValidationError[] = [];

  for (const field of extraFields(value, PROFILE_FIELDS)) {
    errors.push({ field, message: "is not allowed" });
  }

  requireNonEmptyString(value, "id", errors);
  requireNonEmptyString(value, "label", errors);
  requireNonEmptyString(value, "providerName", errors);
  requireNonEmptyString(value, "model", errors);

  if (value.adapterId !== "reasonix") {
    errors.push({
      field: "adapterId",
      message: 'must be "reasonix"',
    });
  }

  if (
    !isNonEmptyString(value.apiKeyEnv) ||
    !ENV_NAME_PATTERN.test(value.apiKeyEnv)
  ) {
    errors.push({
      field: "apiKeyEnv",
      message: "must be a valid environment variable name",
    });
  }

  errors.push(...credentialRefErrors(value.credentialRef, "credentialRef"));

  if (isRecord(value.credentialRef)) {
    if (value.credentialRef.providerName !== value.providerName) {
      errors.push({
        field: "credentialRef.providerName",
        message: "must match providerName",
      });
    }

    if (value.credentialRef.apiKeyEnv !== value.apiKeyEnv) {
      errors.push({
        field: "credentialRef.apiKeyEnv",
        message: "must match apiKeyEnv",
      });
    }
  }

  for (const field of ["createdAt", "updatedAt"] as const) {
    if (!isTimestamp(value[field])) {
      errors.push({
        field,
        message: "must be a valid timestamp",
      });
    }
  }

  return errors;
}

/** Runtime guard for a valid non-secret runtime profile. */
export function isRuntimeProfile(value: unknown): value is RuntimeProfile {
  return validateRuntimeProfile(value).length === 0;
}
