import { describe, expect, it } from "vitest";
import { en, fa } from "../../i18n/messages";
import type { RuntimeProviderCatalog } from "../../types/runtime-catalog";
import {
  CONNECTION_TEST_FAILURE_CODES,
  type CredentialStatus,
  type RuntimeProfile,
} from "../../types/runtime-settings";
import {
  SETTINGS_ERROR_CODES,
  type SettingsProfileView,
} from "../../types/settings-api";
import {
  formSelectionFromProfile,
  groupProfilesByApiKeyEnv,
  initialFormSelection,
  isCredentialStatus,
  modelAfterProviderChange,
  modelsForProvider,
  narrowCatalogResponse,
  narrowConnectionTestResponse,
  narrowCredentialStatusResponse,
  narrowProfileResponse,
  narrowProfilesResponse,
  parseSettingsFailure,
  parseSettingsFieldErrors,
  selectableProviders,
} from "./screen";

function profile(overrides: Partial<RuntimeProfile> = {}): RuntimeProfile {
  const providerName = overrides.providerName ?? "deepseek";
  const apiKeyEnv = overrides.apiKeyEnv ?? "DEEPSEEK_API_KEY";

  return {
    id: "profile-1",
    label: "Default",
    adapterId: "reasonix",
    providerName,
    model: "deepseek-flash",
    apiKeyEnv,
    createdAt: "2026-10-31T00:00:00.000Z",
    updatedAt: "2026-10-31T00:00:00.000Z",
    ...overrides,
    credentialRef: {
      kind: "reasonix-env",
      providerName,
      apiKeyEnv,
    },
  };
}

function view(
  credentialStatus: CredentialStatus,
  overrides: Partial<RuntimeProfile> = {},
): SettingsProfileView {
  return { profile: profile(overrides), credentialStatus };
}

function catalog(
  overrides: Partial<RuntimeProviderCatalog> = {},
): RuntimeProviderCatalog {
  return {
    source: "reasonix-doctor",
    reasonixVersion: "2.54.0",
    providers: [
      {
        name: "deepseek",
        models: ["deepseek-flash", "deepseek-pro"],
        apiKeyEnv: "DEEPSEEK_API_KEY",
        credentialStatus: "present",
      },
      {
        name: "local",
        models: ["local-small"],
        apiKeyEnv: null,
        credentialStatus: "missing",
      },
      {
        name: "openai",
        models: ["gpt-5"],
        apiKeyEnv: "OPENAI_API_KEY",
        credentialStatus: "unknown",
      },
    ],
    configuredDefaultModel: "deepseek/deepseek-flash",
    defaultSelection: {
      providerName: "deepseek",
      model: "deepseek-flash",
    },
    ...overrides,
  };
}

describe("groupProfilesByApiKeyEnv", () => {
  it("returns no groups for an empty list", () => {
    expect(groupProfilesByApiKeyEnv([])).toEqual([]);
  });

  it("groups profiles by apiKeyEnv in first-appearance order", () => {
    const groups = groupProfilesByApiKeyEnv([
      view("present", { id: "a" }),
      view("missing", {
        id: "b",
        providerName: "openai",
        model: "gpt-5",
        apiKeyEnv: "OPENAI_API_KEY",
      }),
      view("present", { id: "c" }),
    ]);

    expect(groups.map((group) => group.apiKeyEnv)).toEqual([
      "DEEPSEEK_API_KEY",
      "OPENAI_API_KEY",
    ]);
    expect(groups[0].profiles.map((entry) => entry.id)).toEqual(["a", "c"]);
    expect(groups[0].credentialStatus).toBe("present");
  });

  it("preserves the profile order returned by the API", () => {
    const groups = groupProfilesByApiKeyEnv([
      view("present", { id: "z", label: "Z" }),
      view("present", { id: "a", label: "A" }),
    ]);

    expect(groups[0].profiles.map((entry) => entry.id)).toEqual(["z", "a"]);
  });

  it("uses unknown when profiles in one group disagree", () => {
    const groups = groupProfilesByApiKeyEnv([
      view("present", { id: "a" }),
      view("missing", { id: "b" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].credentialStatus).toBe("unknown");
  });

  it("keeps each credential status when the group agrees", () => {
    for (const status of ["missing", "present", "unknown"] as const) {
      const groups = groupProfilesByApiKeyEnv([view(status)]);

      expect(groups[0].credentialStatus).toBe(status);
      expect(isCredentialStatus(status)).toBe(true);
    }
  });
});

describe("provider and model selection", () => {
  it("filters out providers without an API-key environment name", () => {
    expect(selectableProviders(catalog()).map((entry) => entry.name)).toEqual([
      "deepseek",
      "openai",
    ]);
  });

  it("uses a valid configured default", () => {
    expect(initialFormSelection(catalog())).toEqual({
      providerName: "deepseek",
      model: "deepseek-flash",
      unavailable: false,
    });
  });

  it("falls back to the first selectable provider for an invalid default", () => {
    expect(
      initialFormSelection(
        catalog({
          defaultSelection: {
            providerName: "local",
            model: "local-small",
          },
        }),
      ),
    ).toEqual({
      providerName: "deepseek",
      model: "deepseek-flash",
      unavailable: false,
    });
  });

  it("returns an empty selection when no provider can be used", () => {
    expect(
      initialFormSelection(
        catalog({
          providers: [
            {
              name: "local",
              models: ["local-small"],
              apiKeyEnv: null,
              credentialStatus: "missing",
            },
          ],
          defaultSelection: null,
        }),
      ),
    ).toEqual({ providerName: null, model: null, unavailable: false });
  });

  it("returns the listed models and the first model after a provider change", () => {
    expect(modelsForProvider(catalog(), "deepseek")).toEqual([
      "deepseek-flash",
      "deepseek-pro",
    ]);
    expect(modelsForProvider(catalog(), "local")).toEqual([]);
    expect(modelsForProvider(catalog(), null)).toEqual([]);
    expect(modelAfterProviderChange(catalog(), "openai")).toBe("gpt-5");
  });

  it("keeps a stored provider and model that still resolve", () => {
    expect(
      formSelectionFromProfile(
        catalog(),
        profile({ providerName: "openai", model: "gpt-5", apiKeyEnv: "OPENAI_API_KEY" }),
      ),
    ).toEqual({
      providerName: "openai",
      model: "gpt-5",
      unavailable: false,
    });
  });

  it("clears a stored model that is no longer listed", () => {
    expect(
      formSelectionFromProfile(
        catalog(),
        profile({ model: "deepseek-retired" }),
      ),
    ).toEqual({
      providerName: "deepseek",
      model: null,
      unavailable: true,
    });
  });

  it("clears both values when the stored provider is not selectable", () => {
    expect(
      formSelectionFromProfile(
        catalog(),
        profile({
          providerName: "local",
          model: "local-small",
          apiKeyEnv: "LOCAL_KEY",
        }),
      ),
    ).toEqual({
      providerName: null,
      model: null,
      unavailable: true,
    });
  });
});

describe("settings failure parsing", () => {
  it("accepts every server error code", () => {
    for (const code of SETTINGS_ERROR_CODES) {
      expect(
        parseSettingsFailure(400, { error: { code, message: "ignored" } }),
      ).toBe(code);
    }
  });

  it("maps an unknown or malformed code to unexpected", () => {
    expect(
      parseSettingsFailure(500, { error: { code: "new_code", message: "x" } }),
    ).toBe("unexpected");
    expect(parseSettingsFailure(500, { nope: true })).toBe("unexpected");
    expect(parseSettingsFailure(500, null)).toBe("unexpected");
  });

  it("maps a transport failure to network", () => {
    expect(parseSettingsFailure(0, null)).toBe("network");
  });

  it("keeps only known field names and collapses the rest", () => {
    expect(
      parseSettingsFieldErrors({
        error: {
          code: "invalid_request",
          message: "ignored",
          fields: [
            { field: "label", message: "x" },
            { field: "secret", message: "x" },
            { field: "apiKeyEnv", message: "x" },
            { field: "label", message: "x" },
            null,
          ],
        },
      }),
    ).toEqual(["label", "secret", "body"]);

    expect(parseSettingsFieldErrors({ error: {} })).toEqual([]);
    expect(parseSettingsFieldErrors(null)).toEqual([]);
  });
});

describe("response narrowing", () => {
  it("accepts a documented catalog response", () => {
    expect(narrowCatalogResponse({ catalog: catalog() })).toEqual(catalog());
  });

  it("rejects malformed catalog responses", () => {
    expect(narrowCatalogResponse(null)).toBeNull();
    expect(narrowCatalogResponse({})).toBeNull();
    expect(
      narrowCatalogResponse({
        catalog: { ...catalog(), providers: "deepseek" },
      }),
    ).toBeNull();
    expect(
      narrowCatalogResponse({
        catalog: {
          ...catalog(),
          providers: [
            {
              name: "deepseek",
              models: "deepseek-flash",
              apiKeyEnv: "DEEPSEEK_API_KEY",
              credentialStatus: "present",
            },
          ],
        },
      }),
    ).toBeNull();
    expect(
      narrowCatalogResponse({
        catalog: { ...catalog(), source: "other" },
      }),
    ).toBeNull();
  });

  it("accepts a null default selection and rejects a malformed one", () => {
    expect(
      narrowCatalogResponse({ catalog: catalog({ defaultSelection: null }) }),
    ).toEqual(catalog({ defaultSelection: null }));
    expect(
      narrowCatalogResponse({
        catalog: { ...catalog(), defaultSelection: { providerName: "deepseek" } },
      }),
    ).toBeNull();
  });

  it("accepts a documented profiles response", () => {
    const views = [view("present"), view("missing", { id: "b" })];

    expect(narrowProfilesResponse({ profiles: views })).toEqual(views);
  });

  it("rejects malformed profile responses", () => {
    expect(narrowProfilesResponse(null)).toBeNull();
    expect(narrowProfilesResponse({ profiles: "none" })).toBeNull();
    expect(
      narrowProfilesResponse({
        profiles: [{ profile: { id: "x" }, credentialStatus: "present" }],
      }),
    ).toBeNull();
    expect(
      narrowProfilesResponse({
        profiles: [{ profile: profile(), credentialStatus: "valid" }],
      }),
    ).toBeNull();
  });

  it("narrows single profile and credential status responses", () => {
    expect(narrowProfileResponse({ profile: profile() })).toEqual(profile());
    expect(narrowProfileResponse({ profile: { id: "x" } })).toBeNull();
    expect(narrowCredentialStatusResponse({ status: "present" })).toBe("present");
    expect(narrowCredentialStatusResponse({ status: "valid" })).toBeNull();
  });

  it("narrows a connection-test response", () => {
    expect(
      narrowConnectionTestResponse({ result: { outcome: "succeeded" } }),
    ).toEqual({ outcome: "succeeded" });
    expect(
      narrowConnectionTestResponse({
        result: { outcome: "failed", code: "credential_missing" },
      }),
    ).toEqual({ outcome: "failed", code: "credential_missing" });
  });

  it("rejects malformed connection-test responses", () => {
    for (const value of [
      null,
      {},
      { result: null },
      { result: { outcome: "other" } },
      { result: { outcome: "failed" } },
      { result: { outcome: "failed", code: "other" } },
    ]) {
      expect(narrowConnectionTestResponse(value)).toBeNull();
    }
  });
});

describe("localized settings messages", () => {
  it("covers every server failure code in both catalogs", () => {
    for (const code of SETTINGS_ERROR_CODES) {
      expect(en.settings.errors[code]).not.toBe("");
      expect(fa.settings.errors[code]).not.toBe("");
    }
  });

  it("covers the client-only failure codes", () => {
    expect(en.settings.errors.network).not.toBe("");
    expect(fa.settings.errors.network).not.toBe("");
    expect(en.settings.errors.unexpected).not.toBe("");
    expect(fa.settings.errors.unexpected).not.toBe("");
  });

  it("labels every credential status", () => {
    for (const status of ["missing", "present", "unknown"] as const) {
      expect(en.settings.status[status]).not.toBe("");
      expect(fa.settings.status[status]).not.toBe("");
    }
  });

  it("covers every connection-test failure code in both catalogs", () => {
    for (const code of CONNECTION_TEST_FAILURE_CODES) {
      expect(en.settings.connection.errors[code]).not.toBe("");
      expect(fa.settings.connection.errors[code]).not.toBe("");
    }

    expect(en.settings.connection.hint).not.toBe("");
    expect(fa.settings.connection.hint).not.toBe("");
  });
});
