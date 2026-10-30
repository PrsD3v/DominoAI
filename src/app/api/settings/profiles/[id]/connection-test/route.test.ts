import { describe, expect, it } from "vitest";
import { handleSettingsRequest } from "../../../../../../lib/settings/http";
import {
  SettingsError,
  type SettingsService,
} from "../../../../../../lib/settings/service";
import { handleTestConnection } from "./route";

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

function testRequest(): Request {
  return new Request(
    "http://localhost/api/settings/profiles/profile-1/connection-test",
    { method: "POST" },
  );
}

describe("POST /api/settings/profiles/:id/connection-test", () => {
  it("passes the profile id through and returns the typed result", async () => {
    let received: string | undefined;
    const service = serviceWith({
      testConnection: async (id) => {
        received = id;
        return { outcome: "succeeded" };
      },
    });

    const response = await handleTestConnection(
      testRequest(),
      "profile-1",
      service,
    );

    expect(received).toBe("profile-1");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      result: { outcome: "succeeded" },
    });
  });

  it("returns a typed failed result with status 200", async () => {
    const service = serviceWith({
      testConnection: async () => ({
        outcome: "failed",
        code: "credential_missing",
      }),
    });

    const response = await handleTestConnection(
      testRequest(),
      "profile-1",
      service,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      result: { outcome: "failed", code: "credential_missing" },
    });
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("maps an unknown profile to a typed 404", async () => {
    const service = serviceWith({
      testConnection: async () => {
        throw new SettingsError("profile_not_found");
      },
    });

    const response = await handleSettingsRequest(() =>
      handleTestConnection(testRequest(), "missing", service),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "profile_not_found" },
    });
  });
});
