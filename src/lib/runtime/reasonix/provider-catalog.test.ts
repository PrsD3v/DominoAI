import { describe, expect, it } from "vitest";
import type { RuntimeProviderCatalog } from "../../../types/runtime-catalog";
import {
  loadReasonixProviderCatalog,
  parseReasonixDoctorCatalog,
  ReasonixProviderCatalogError,
} from "./provider-catalog";

function doctor(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: "v2.54.0",
    config: { default_model: "deepseek/deepseek-flash" },
    providers: [
      {
        name: "deepseek",
        models: ["deepseek-flash", "deepseek-v4-pro"],
        api_key_env: "DEEPSEEK_API_KEY",
        key_present: true,
      },
    ],
    ...overrides,
  };
}

function catalogError(run: () => unknown): ReasonixProviderCatalogError {
  try {
    run();
  } catch (error) {
    if (error instanceof ReasonixProviderCatalogError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected a catalog error.");
}

async function asyncCatalogError(
  run: () => Promise<unknown>,
): Promise<ReasonixProviderCatalogError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ReasonixProviderCatalogError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected a catalog error.");
}

describe("parseReasonixDoctorCatalog", () => {
  it("parses the installed v2.54.0 metadata using allowlisted fields", () => {
    const catalog: RuntimeProviderCatalog = parseReasonixDoctorCatalog({
      version: "v2.54.0",
      os: "linux",
      arch: "amd64",
      config: {
        source_path: "~/.reasonix/config.toml",
        user_path: "~/.reasonix/config.toml",
        default_model: "deepseek/deepseek-flash",
      },
      providers: [
        {
          name: "deepseek",
          kind: "openai",
          base_url_host: "api.deepseek.com",
          models: ["deepseek-flash", "deepseek-v4-pro"],
          api_key_env: "DEEPSEEK_API_KEY",
          key_present: false,
          is_default: false,
          context_window: 1000000,
        },
      ],
    });

    expect(catalog).toEqual({
      source: "reasonix-doctor",
      reasonixVersion: "v2.54.0",
      providers: [
        {
          name: "deepseek",
          models: ["deepseek-flash", "deepseek-v4-pro"],
          apiKeyEnv: "DEEPSEEK_API_KEY",
          credentialStatus: "missing",
        },
      ],
      configuredDefaultModel: "deepseek/deepseek-flash",
      defaultSelection: {
        providerName: "deepseek",
        model: "deepseek-flash",
      },
    });
    expect(Object.keys(catalog.providers[0])).toEqual([
      "name",
      "models",
      "apiKeyEnv",
      "credentialStatus",
    ]);
  });

  it("supports multiple providers, model deduplication, and credential states", () => {
    const catalog = parseReasonixDoctorCatalog(
      doctor({
        providers: [
          {
            name: "alpha",
            models: ["a1", "a1", "a2"],
            api_key_env: "ALPHA_KEY",
            key_present: true,
          },
          {
            name: "beta",
            models: ["b1"],
            key_present: false,
          },
          {
            name: "gamma",
            models: ["g1"],
          },
        ],
        config: { default_model: "beta/b1" },
      }),
    );

    expect(catalog.providers.map((provider) => provider.name)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
    expect(catalog.providers[0].models).toEqual(["a1", "a2"]);
    expect(catalog.providers[1].credentialStatus).toBe("missing");
    expect(catalog.providers[2].credentialStatus).toBe("unknown");
    expect(catalog.providers[2].apiKeyEnv).toBeNull();
    expect(catalog.defaultSelection).toEqual({
      providerName: "beta",
      model: "b1",
    });
  });

  it("accepts an empty provider list and missing defaults", () => {
    const catalog = parseReasonixDoctorCatalog({
      version: "v2.54.0",
      providers: [],
    });

    expect(catalog.providers).toEqual([]);
    expect(catalog.reasonixVersion).toBe("v2.54.0");
    expect(catalog.configuredDefaultModel).toBeNull();
    expect(catalog.defaultSelection).toBeNull();
  });

  it("rejects a missing providers array", () => {
    const error = catalogError(() =>
      parseReasonixDoctorCatalog({ version: "v2.54.0" }),
    );

    expect(error.code).toBe("malformed_doctor_output");
  });

  it("rejects malformed provider entries", () => {
    for (const provider of [
      {},
      { name: "x", models: "not-an-array" },
      { name: "x", models: [""] },
      { name: "x", models: [1] },
    ]) {
      const error = catalogError(() =>
        parseReasonixDoctorCatalog(doctor({ providers: [provider] })),
      );

      expect(error.code).toBe("malformed_doctor_output");
    }
  });

  it("rejects duplicate provider names", () => {
    const error = catalogError(() =>
      parseReasonixDoctorCatalog(
        doctor({
          providers: [
            { name: "duplicate", models: ["a"], key_present: true },
            { name: "duplicate", models: ["b"], key_present: true },
          ],
        }),
      ),
    );

    expect(error.code).toBe("duplicate_provider");
    expect(error.detail).toBe("duplicate");
  });

  it("rejects invalid api_key_env names", () => {
    const error = catalogError(() =>
      parseReasonixDoctorCatalog(
        doctor({
          providers: [
            {
              name: "x",
              models: ["m"],
              api_key_env: "BAD NAME",
              key_present: true,
            },
          ],
        }),
      ),
    );

    expect(error.code).toBe("malformed_doctor_output");
  });

  it("rejects malformed key_present values", () => {
    const error = catalogError(() =>
      parseReasonixDoctorCatalog(
        doctor({
          providers: [
            { name: "x", models: ["m"], key_present: "yes" },
          ],
        }),
      ),
    );

    expect(error.code).toBe("malformed_doctor_output");
  });

  it("uses unknown credential status when key presence is absent", () => {
    const catalog = parseReasonixDoctorCatalog(
      doctor({
        providers: [{ name: "x", models: ["m"] }],
        config: {},
      }),
    );

    expect(catalog.providers[0].credentialStatus).toBe("unknown");
    expect(catalog.providers[0].apiKeyEnv).toBeNull();
    expect(catalog.configuredDefaultModel).toBeNull();
    expect(catalog.defaultSelection).toBeNull();
  });

  it("does not resolve a default to an unknown provider or model", () => {
    for (const defaultModel of [
      "unknown/model",
      "deepseek/unknown-model",
      "deepseek",
      "/deepseek-flash",
      "deepseek/",
    ]) {
      const catalog = parseReasonixDoctorCatalog(
        doctor({ config: { default_model: defaultModel } }),
      );

      expect(catalog.configuredDefaultModel).toBe(defaultModel);
      expect(catalog.defaultSelection).toBeNull();
    }
  });

  it("resolves a configured default only when metadata matches", () => {
    const catalog = parseReasonixDoctorCatalog(
      doctor({ config: { default_model: " deepseek/deepseek-flash " } }),
    );

    expect(catalog.configuredDefaultModel).toBe(
      "deepseek/deepseek-flash",
    );
    expect(catalog.defaultSelection).toEqual({
      providerName: "deepseek",
      model: "deepseek-flash",
    });
  });

  it("rejects malformed config and version fields", () => {
    const configError = catalogError(() =>
      parseReasonixDoctorCatalog(doctor({ config: "bad" })),
    );
    const versionError = catalogError(() =>
      parseReasonixDoctorCatalog(doctor({ version: 2 })),
    );

    expect(configError.code).toBe("malformed_doctor_output");
    expect(versionError.code).toBe("malformed_doctor_output");
  });

  it("returns null when version is missing", () => {
    const catalog = parseReasonixDoctorCatalog({
      providers: [],
    });

    expect(catalog.reasonixVersion).toBeNull();
  });

  it("never copies secret-like unknown fields into the catalog", () => {
    const secret = "sk-catalog-secret-value";
    const catalog = parseReasonixDoctorCatalog(
      doctor({
        providers: [
          {
            name: "deepseek",
            models: ["deepseek-flash"],
            api_key_env: "DEEPSEEK_API_KEY",
            key_present: true,
            api_key: secret,
            secret,
            token: secret,
            value: secret,
          },
        ],
        config: {
          default_model: "deepseek/deepseek-flash",
          api_key: secret,
          credential: secret,
        },
      }),
    );

    expect(catalog.providers[0].credentialStatus).toBe("present");
    expect(JSON.stringify(catalog)).not.toContain(secret);
    expect(Object.keys(catalog.providers[0])).not.toContain("api_key");
  });
});

describe("loadReasonixProviderCatalog", () => {
  it("loads a valid doctor JSON payload", async () => {
    const catalog = await loadReasonixProviderCatalog(async () =>
      JSON.stringify(doctor()),
    );

    expect(catalog.providers[0].name).toBe("deepseek");
    expect(catalog.defaultSelection).toEqual({
      providerName: "deepseek",
      model: "deepseek-flash",
    });
  });

  it("wraps command failures without exposing the original error", async () => {
    const secret = "sk-command-failure-secret";
    const error = await asyncCatalogError(() =>
      loadReasonixProviderCatalog(async () => {
        throw new Error(secret);
      }),
    );

    expect(error.code).toBe("command_failed");
    expect(String(error)).not.toContain(secret);
  });

  it("rejects invalid JSON without exposing the payload", async () => {
    const secret = "sk-invalid-json-secret";
    const error = await asyncCatalogError(() =>
      loadReasonixProviderCatalog(async () => `not-json ${secret}`),
    );

    expect(error.code).toBe("invalid_json");
    expect(String(error)).not.toContain(secret);
  });

  it("propagates malformed doctor output as a catalog error", async () => {
    const error = await asyncCatalogError(() =>
      loadReasonixProviderCatalog(async () => JSON.stringify({})),
    );

    expect(error.code).toBe("malformed_doctor_output");
  });
});
