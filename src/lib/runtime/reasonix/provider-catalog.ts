import { execFile } from "node:child_process";
import type {
  RuntimeDefaultSelection,
  RuntimeProviderCatalog,
  RuntimeProviderCatalogEntry,
} from "../../../types/runtime-catalog";
import type {
  ApiKeyEnvName,
  CredentialStatus,
} from "../../../types/runtime-settings";

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type ReasonixProviderCatalogErrorCode =
  | "command_failed"
  | "invalid_json"
  | "malformed_doctor_output"
  | "duplicate_provider";

/** Catalog error that never carries command output or credential values. */
export class ReasonixProviderCatalogError extends Error {
  readonly code: ReasonixProviderCatalogErrorCode;
  readonly detail?: string;

  constructor(
    code: ReasonixProviderCatalogErrorCode,
    message: string,
    detail?: string,
  ) {
    super(message);
    this.name = "ReasonixProviderCatalogError";
    this.code = code;
    this.detail = detail;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function malformed(detail?: string): ReasonixProviderCatalogError {
  return new ReasonixProviderCatalogError(
    "malformed_doctor_output",
    "Reasonix doctor output is malformed.",
    detail,
  );
}

function optionalString(
  value: unknown,
  detail: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw malformed(detail);
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function parseApiKeyEnv(
  value: unknown,
  detail: string,
): ApiKeyEnvName | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string" || !ENV_NAME_PATTERN.test(value)) {
    throw malformed(detail);
  }

  return value;
}

function parseCredentialStatus(
  value: unknown,
  detail: string,
): CredentialStatus {
  if (value === undefined || value === null) {
    return "unknown";
  }

  if (typeof value === "boolean") {
    return value ? "present" : "missing";
  }

  throw malformed(detail);
}

function resolveDefault(
  model: string | null,
  providers: readonly RuntimeProviderCatalogEntry[],
): RuntimeDefaultSelection | null {
  if (model === null) {
    return null;
  }

  const slash = model.indexOf("/");

  if (slash <= 0 || slash === model.length - 1) {
    return null;
  }

  const providerName = model.slice(0, slash);
  const modelName = model.slice(slash + 1);
  const provider = providers.find((entry) => entry.name === providerName);

  if (!provider || !provider.models.includes(modelName)) {
    return null;
  }

  return { providerName, model: modelName };
}

/**
 * Parse the non-secret subset of `reasonix doctor --json`.
 * Unknown fields are ignored; credential values are never copied.
 */
export function parseReasonixDoctorCatalog(
  value: unknown,
): RuntimeProviderCatalog {
  if (!isRecord(value)) {
    throw malformed();
  }

  const reasonixVersion = optionalString(value.version, "version");

  if (!Array.isArray(value.providers)) {
    throw malformed("providers");
  }

  const providers: RuntimeProviderCatalogEntry[] = [];
  const seenProviders = new Set<string>();

  for (const [index, rawProvider] of value.providers.entries()) {
    if (!isRecord(rawProvider)) {
      throw malformed(`providers[${index}]`);
    }

    const name = isNonEmptyString(rawProvider.name)
      ? rawProvider.name.trim()
      : "";

    if (name === "") {
      throw malformed(`providers[${index}].name`);
    }

    if (seenProviders.has(name)) {
      throw new ReasonixProviderCatalogError(
        "duplicate_provider",
        `Reasonix doctor output contains duplicate provider "${name}".`,
        name,
      );
    }

    seenProviders.add(name);

    if (!Array.isArray(rawProvider.models)) {
      throw malformed(`providers[${index}].models`);
    }

    const models: string[] = [];
    const seenModels = new Set<string>();

    for (const [modelIndex, rawModel] of rawProvider.models.entries()) {
      if (!isNonEmptyString(rawModel)) {
        throw malformed(`providers[${index}].models[${modelIndex}]`);
      }

      const model = rawModel.trim();

      if (!seenModels.has(model)) {
        seenModels.add(model);
        models.push(model);
      }
    }

    const apiKeyEnv = parseApiKeyEnv(
      rawProvider.api_key_env,
      `providers[${index}].api_key_env`,
    );
    const credentialStatus = parseCredentialStatus(
      rawProvider.key_present,
      `providers[${index}].key_present`,
    );

    providers.push({
      name,
      models,
      apiKeyEnv,
      credentialStatus,
    });
  }

  let configuredDefaultModel: string | null = null;

  if (value.config !== undefined && value.config !== null) {
    if (!isRecord(value.config)) {
      throw malformed("config");
    }

    configuredDefaultModel = optionalString(
      value.config.default_model,
      "config.default_model",
    );
  }

  return {
    source: "reasonix-doctor",
    reasonixVersion,
    providers,
    configuredDefaultModel,
    defaultSelection: resolveDefault(configuredDefaultModel, providers),
  };
}

export type ReasonixDoctorRunner = () => Promise<string>;

/** Run the installed Reasonix doctor command without a shell. */
export function runReasonixDoctor(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "reasonix",
      ["doctor", "--json"],
      {
        encoding: "utf8",
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          reject(
            new ReasonixProviderCatalogError(
              "command_failed",
              "Could not run reasonix doctor.",
            ),
          );
          return;
        }

        resolve(stdout);
      },
    );
  });
}

/** Load and parse the catalog from a doctor runner, defaulting to the CLI. */
export async function loadReasonixProviderCatalog(
  runDoctor: ReasonixDoctorRunner = runReasonixDoctor,
): Promise<RuntimeProviderCatalog> {
  let stdout: string;

  try {
    stdout = await runDoctor();
  } catch {
    throw new ReasonixProviderCatalogError(
      "command_failed",
      "Could not run reasonix doctor.",
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new ReasonixProviderCatalogError(
      "invalid_json",
      "Reasonix doctor output is not valid JSON.",
    );
  }

  return parseReasonixDoctorCatalog(parsed);
}
