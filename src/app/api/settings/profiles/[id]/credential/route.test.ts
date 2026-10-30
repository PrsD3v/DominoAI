import { describe, expect, it } from "vitest";
import { handleSettingsRequest } from "../../../../../../lib/settings/http";
import {
  SettingsError,
  type SettingsService,
} from "../../../../../../lib/settings/service";
import {
  handleGetCredentialStatus,
  handleRemoveCredential,
  handleSetCredential,
} from "./route";

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

function credentialRequest(body: unknown): Request {
  return new Request(
    "http://localhost/api/settings/profiles/profile-1/credential",
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("credential routes", () => {
  it("returns credential presence for a profile", async () => {
    const service = serviceWith({
      getCredentialStatus: async () => "present",
    });

    const response = await handleGetCredentialStatus(
      new Request("http://localhost/api/settings/profiles/profile-1/credential"),
      "profile-1",
      service,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "present" });
  });

  it("sets a credential without echoing the secret", async () => {
    const secret = "sk-test-very-secret";
    let received: unknown;
    const service = serviceWith({
      setCredential: async (id, body) => {
        received = { id, body };
        return "present";
      },
    });

    const response = await handleSetCredential(
      credentialRequest({ secret }),
      "profile-1",
      service,
    );

    expect(response.status).toBe(200);
    expect(received).toEqual({ id: "profile-1", body: { secret } });
    const responseBody = await response.json();
    expect(responseBody).toEqual({ status: "present" });
    expect(JSON.stringify(responseBody)).not.toContain(secret);
  });

  it("maps an invalid secret to a typed 400", async () => {
    const service = serviceWith({
      setCredential: async () => {
        throw new SettingsError("invalid_secret");
      },
    });

    const response = await handleSettingsRequest(() =>
      handleSetCredential(
        credentialRequest({ secret: "bad key" }),
        "profile-1",
        service,
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_secret" },
    });
  });

  it("requires a JSON content type when setting a credential", async () => {
    const service = serviceWith({});

    const response = await handleSettingsRequest(() =>
      handleSetCredential(
        new Request(
          "http://localhost/api/settings/profiles/profile-1/credential",
          { method: "PUT", body: JSON.stringify({ secret: "sk-test" }) },
        ),
        "profile-1",
        service,
      ),
    );

    expect(response.status).toBe(415);
  });

  it("removes a credential and returns missing", async () => {
    const service = serviceWith({
      removeCredential: async () => "missing",
    });

    const response = await handleRemoveCredential(
      new Request(
        "http://localhost/api/settings/profiles/profile-1/credential",
        { method: "DELETE" },
      ),
      "profile-1",
      service,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "missing" });
  });

  it.each(["GET", "PUT", "DELETE"] as const)(
    "returns 404 for an unknown profile on %s",
    async (method) => {
      const notFound = async (): Promise<never> => {
        throw new SettingsError("profile_not_found");
      };
      const service = serviceWith({
        getCredentialStatus: notFound,
        setCredential: notFound,
        removeCredential: notFound,
      });

      const response = await handleSettingsRequest(async () => {
        if (method === "GET") {
          return handleGetCredentialStatus(
            new Request("http://localhost/api/settings/profiles/missing/credential"),
            "missing",
            service,
          );
        }

        if (method === "PUT") {
          return handleSetCredential(
            credentialRequest({ secret: "sk-test" }),
            "missing",
            service,
          );
        }

        return handleRemoveCredential(
          new Request("http://localhost/api/settings/profiles/missing/credential"),
          "missing",
          service,
        );
      });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "profile_not_found" },
      });
    },
  );
});
