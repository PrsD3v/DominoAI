import { describe, expect, it } from "vitest";
import { handleSettingsRequest } from "../../../../../lib/settings/http";
import {
  SettingsError,
  type SettingsService,
} from "../../../../../lib/settings/service";
import type { RuntimeProfile } from "../../../../../types/runtime-settings";
import { handleUpdateProfile } from "./route";

const profile: RuntimeProfile = {
  id: "profile-1",
  label: "Renamed",
  adapterId: "reasonix",
  providerName: "openrouter",
  model: "z-ai/glm-4.6",
  apiKeyEnv: "OPENROUTER_API_KEY",
  credentialRef: {
    kind: "reasonix-env",
    providerName: "openrouter",
    apiKeyEnv: "OPENROUTER_API_KEY",
  },
  createdAt: "2026-10-30T00:00:00.000Z",
  updatedAt: "2026-10-30T01:00:00.000Z",
};

const input = {
  label: "Renamed",
  providerName: "openrouter",
  model: "z-ai/glm-4.6",
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
    testConnection: unexpected,
    getProjectDefaultProfile: unexpected,
    updateProjectDefaultProfile: unexpected,
    ...overrides,
  };
}

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/settings/profiles/profile-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/settings/profiles/:id", () => {
  it("updates a profile and passes the id through", async () => {
    let received: unknown;
    const service = serviceWith({
      updateProfile: async (id, body) => {
        received = { id, body };
        return profile;
      },
    });

    const response = await handleUpdateProfile(
      jsonRequest(input),
      "profile-1",
      service,
    );

    expect(response.status).toBe(200);
    expect(received).toEqual({ id: "profile-1", body: input });
    await expect(response.json()).resolves.toEqual({ profile });
  });

  it("returns 404 for an unknown profile", async () => {
    const service = serviceWith({
      updateProfile: async () => {
        throw new SettingsError("profile_not_found");
      },
    });

    const response = await handleSettingsRequest(() =>
      handleUpdateProfile(jsonRequest(input), "missing", service),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "profile_not_found" },
    });
  });

  it("requires a JSON content type", async () => {
    const service = serviceWith({});

    const response = await handleSettingsRequest(() =>
      handleUpdateProfile(
        new Request("http://localhost/api/settings/profiles/profile-1", {
          method: "PATCH",
          body: JSON.stringify(input),
        }),
        "profile-1",
        service,
      ),
    );

    expect(response.status).toBe(415);
  });

  it("rejects malformed JSON", async () => {
    const service = serviceWith({});

    const response = await handleSettingsRequest(() =>
      handleUpdateProfile(
        new Request("http://localhost/api/settings/profiles/profile-1", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: "{",
        }),
        "profile-1",
        service,
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_json" },
    });
  });
});
