import { describe, expect, it } from "vitest";
import { handleSettingsRequest } from "../../../../lib/settings/http";
import { SettingsError, type SettingsService } from "../../../../lib/settings/service";
import type { RuntimeProviderCatalog } from "../../../../types/runtime-catalog";
import { handleGetProviders } from "./route";

const catalog: RuntimeProviderCatalog = {
  source: "reasonix-doctor",
  reasonixVersion: "2.54.0",
  providers: [
    {
      name: "deepseek",
      models: ["deepseek-flash"],
      apiKeyEnv: "DEEPSEEK_API_KEY",
      credentialStatus: "present",
    },
  ],
  configuredDefaultModel: "deepseek/deepseek-flash",
  defaultSelection: { providerName: "deepseek", model: "deepseek-flash" },
};

function serviceWith(overrides: Partial<SettingsService>): SettingsService {
  const unexpected = async (): Promise<never> => {
    throw new Error("unexpected settings call");
  };

  return {
    loadCatalog: unexpected,
    listProfiles: unexpected,
    createProfile: unexpected,
    updateProfile: unexpected,
    getCredentialStatus: unexpected,
    setCredential: unexpected,
    removeCredential: unexpected,
    ...overrides,
  };
}

function request(): Request {
  return new Request("http://localhost/api/settings/providers");
}

describe("GET /api/settings/providers", () => {
  it("returns the provider catalog", async () => {
    const service = serviceWith({ loadCatalog: async () => catalog });

    const response = await handleGetProviders(request(), service);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ catalog });
  });

  it("maps a catalog failure to a typed 503 without upstream detail", async () => {
    const service = serviceWith({
      loadCatalog: async () => {
        throw new SettingsError("catalog_unavailable");
      },
    });

    const response = await handleSettingsRequest(() =>
      handleGetProviders(request(), service),
    );

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: "catalog_unavailable",
        message: "The Reasonix provider catalog is unavailable.",
      },
    });
  });
});
