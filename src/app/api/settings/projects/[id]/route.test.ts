import { describe, expect, it } from "vitest";
import { handleSettingsRequest } from "../../../../../lib/settings/http";
import {
  SettingsError,
  type SettingsService,
} from "../../../../../lib/settings/service";
import type { SettingsProjectDefaultProfileResponse } from "../../../../../types/settings-api";
import {
  handleGetProjectDefaultProfile,
  handleUpdateProjectDefaultProfile,
} from "./route";

const view: SettingsProjectDefaultProfileResponse = {
  projectId: "project-1",
  defaultRuntimeProfileId: "profile-1",
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
  return new Request("http://localhost/api/settings/projects/project-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/settings/projects/:id", () => {
  it("returns the stored project default profile", async () => {
    const service = serviceWith({
      getProjectDefaultProfile: async (projectId) => {
        expect(projectId).toBe("project-1");
        return view;
      },
    });

    const response = await handleGetProjectDefaultProfile(
      new Request("http://localhost/api/settings/projects/project-1"),
      "project-1",
      service,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(view);
  });

  it("returns 404 for an unknown project", async () => {
    const service = serviceWith({
      getProjectDefaultProfile: async () => {
        throw new SettingsError("project_not_found");
      },
    });

    const response = await handleSettingsRequest(() =>
      handleGetProjectDefaultProfile(
        new Request("http://localhost/api/settings/projects/missing"),
        "missing",
        service,
      ),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "project_not_found" },
    });
  });
});

describe("PATCH /api/settings/projects/:id", () => {
  it("sets the default profile and passes the id and body through", async () => {
    let received: unknown;
    const service = serviceWith({
      updateProjectDefaultProfile: async (projectId, body) => {
        received = { projectId, body };
        return view;
      },
    });

    const response = await handleUpdateProjectDefaultProfile(
      jsonRequest({ defaultRuntimeProfileId: "profile-1" }),
      "project-1",
      service,
    );

    expect(response.status).toBe(200);
    expect(received).toEqual({
      projectId: "project-1",
      body: { defaultRuntimeProfileId: "profile-1" },
    });
    await expect(response.json()).resolves.toEqual(view);
  });

  it("clears the default profile with null", async () => {
    let received: unknown;
    const service = serviceWith({
      updateProjectDefaultProfile: async (projectId, body) => {
        received = { projectId, body };
        return { projectId, defaultRuntimeProfileId: null };
      },
    });

    const response = await handleUpdateProjectDefaultProfile(
      jsonRequest({ defaultRuntimeProfileId: null }),
      "project-1",
      service,
    );

    expect(response.status).toBe(200);
    expect(received).toEqual({
      projectId: "project-1",
      body: { defaultRuntimeProfileId: null },
    });
    await expect(response.json()).resolves.toEqual({
      projectId: "project-1",
      defaultRuntimeProfileId: null,
    });
  });

  it("requires a JSON content type", async () => {
    const service = serviceWith({});

    const response = await handleSettingsRequest(() =>
      handleUpdateProjectDefaultProfile(
        new Request("http://localhost/api/settings/projects/project-1", {
          method: "PATCH",
          body: JSON.stringify({ defaultRuntimeProfileId: null }),
        }),
        "project-1",
        service,
      ),
    );

    expect(response.status).toBe(415);
  });

  it("rejects malformed JSON", async () => {
    const service = serviceWith({});

    const response = await handleSettingsRequest(() =>
      handleUpdateProjectDefaultProfile(
        new Request("http://localhost/api/settings/projects/project-1", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: "{",
        }),
        "project-1",
        service,
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_json" },
    });
  });

  it("returns 400 for an invalid field", async () => {
    const service = serviceWith({
      updateProjectDefaultProfile: async () => {
        throw new SettingsError("invalid_request", [
          {
            field: "defaultRuntimeProfileId",
            message: "must be a non-empty string or null",
          },
        ]);
      },
    });

    const response = await handleSettingsRequest(() =>
      handleUpdateProjectDefaultProfile(
        jsonRequest({ defaultRuntimeProfileId: "" }),
        "project-1",
        service,
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "invalid_request",
        fields: [{ field: "defaultRuntimeProfileId" }],
      },
    });
  });

  it("returns 404 for an unknown profile", async () => {
    const service = serviceWith({
      updateProjectDefaultProfile: async () => {
        throw new SettingsError("profile_not_found");
      },
    });

    const response = await handleSettingsRequest(() =>
      handleUpdateProjectDefaultProfile(
        jsonRequest({ defaultRuntimeProfileId: "missing-profile" }),
        "project-1",
        service,
      ),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "profile_not_found" },
    });
  });

  it("returns 404 for an unknown project", async () => {
    const service = serviceWith({
      updateProjectDefaultProfile: async () => {
        throw new SettingsError("project_not_found");
      },
    });

    const response = await handleSettingsRequest(() =>
      handleUpdateProjectDefaultProfile(
        jsonRequest({ defaultRuntimeProfileId: null }),
        "missing",
        service,
      ),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "project_not_found" },
    });
  });
});
