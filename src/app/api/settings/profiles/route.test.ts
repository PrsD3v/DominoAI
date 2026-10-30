import { describe, expect, it } from "vitest";
import { handleSettingsRequest } from "../../../../lib/settings/http";
import { SettingsError, type SettingsService } from "../../../../lib/settings/service";
import type { RuntimeProfile } from "../../../../types/runtime-settings";
import { handleCreateProfile, handleListProfiles } from "./route";

const profile: RuntimeProfile = {
  id: "profile-1",
  label: "Default",
  adapterId: "reasonix",
  providerName: "deepseek",
  model: "deepseek-flash",
  apiKeyEnv: "DEEPSEEK_API_KEY",
  credentialRef: {
    kind: "reasonix-env",
    providerName: "deepseek",
    apiKeyEnv: "DEEPSEEK_API_KEY",
  },
  createdAt: "2026-10-30T00:00:00.000Z",
  updatedAt: "2026-10-30T00:00:00.000Z",
};

const profileInput = {
  label: "Default",
  providerName: "deepseek",
  model: "deepseek-flash",
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
    ...overrides,
  };
}

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/settings/profiles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/settings/profiles", () => {
  it("returns profiles with credential status and no secret", async () => {
    const service = serviceWith({
      listProfiles: async () => [
        { profile, credentialStatus: "present" },
      ],
    });

    const response = await handleListProfiles(
      new Request("http://localhost/api/settings/profiles"),
      service,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      profiles: [{ profile, credentialStatus: "present" }],
    });
    expect(JSON.stringify(body)).not.toContain('"secret"');
  });
});

describe("POST /api/settings/profiles", () => {
  it("creates a profile from the JSON body", async () => {
    let received: unknown;
    const service = serviceWith({
      createProfile: async (input) => {
        received = input;
        return profile;
      },
    });

    const response = await handleCreateProfile(jsonRequest(profileInput), service);

    expect(response.status).toBe(201);
    expect(received).toEqual(profileInput);
    await expect(response.json()).resolves.toEqual({ profile });
  });

  it("requires a JSON content type", async () => {
    const service = serviceWith({});

    const response = await handleSettingsRequest(() =>
      handleCreateProfile(
        new Request("http://localhost/api/settings/profiles", {
          method: "POST",
          body: JSON.stringify(profileInput),
        }),
        service,
      ),
    );

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unsupported_media_type" },
    });
  });

  it("rejects malformed JSON", async () => {
    const service = serviceWith({});

    const response = await handleSettingsRequest(() =>
      handleCreateProfile(
        new Request("http://localhost/api/settings/profiles", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{",
        }),
        service,
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_json" },
    });
  });

  it("returns validation fields without echoing the body", async () => {
    const service = serviceWith({
      createProfile: async () => {
        throw new SettingsError("invalid_request", [
          { field: "label", message: "must be a non-empty string" },
        ]);
      },
    });

    const response = await handleSettingsRequest(() =>
      handleCreateProfile(jsonRequest(profileInput), service),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: "invalid_request",
        message: "The settings request is invalid.",
        fields: [{ field: "label", message: "must be a non-empty string" }],
      },
    });
    expect(JSON.stringify(body)).not.toContain("deepseek-flash");
  });
});
