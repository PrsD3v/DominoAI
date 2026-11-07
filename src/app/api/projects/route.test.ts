import { describe, expect, it } from "vitest";
import { handleRunRequest } from "../../../lib/runs/http";
import { RunServiceError } from "../../../lib/runs/service";
import {
  SAMPLE_PROJECT,
  runServiceWith,
} from "../../../lib/runs/test-support";
import { handleCreateProject, handleListProjects } from "./route";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/projects", () => {
  it("returns registered projects", async () => {
    const service = runServiceWith({
      listProjects: async () => [SAMPLE_PROJECT],
    });

    const response = await handleListProjects(service);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      projects: [SAMPLE_PROJECT],
    });
  });

  it("returns an empty collection", async () => {
    const service = runServiceWith({ listProjects: async () => [] });

    const response = await handleListProjects(service);

    await expect(response.json()).resolves.toEqual({ projects: [] });
  });
});

describe("POST /api/projects", () => {
  it("registers a project from the JSON body", async () => {
    let received: unknown;
    const service = runServiceWith({
      registerProject: async (input) => {
        received = input;
        return SAMPLE_PROJECT;
      },
    });
    const body = { name: "Demo", workspaceRoot: "/workspace/demo" };

    const response = await handleCreateProject(jsonRequest(body), service);

    expect(response.status).toBe(201);
    expect(received).toEqual(body);
    await expect(response.json()).resolves.toEqual({
      project: SAMPLE_PROJECT,
    });
  });

  it("requires a JSON content type", async () => {
    const service = runServiceWith({});

    const response = await handleRunRequest(() =>
      handleCreateProject(
        new Request("http://localhost/api/projects", {
          method: "POST",
          body: JSON.stringify({ name: "Demo", workspaceRoot: "/workspace" }),
        }),
        service,
      ),
    );

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unsupported_media_type" },
    });
  });

  it("rejects an unreadable JSON body", async () => {
    const service = runServiceWith({});

    const response = await handleRunRequest(() =>
      handleCreateProject(
        new Request("http://localhost/api/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "not json",
        }),
        service,
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_json" },
    });
  });

  it("maps a typed registration failure", async () => {
    const service = runServiceWith({
      registerProject: async () => {
        throw new RunServiceError("workspace_root_registered");
      },
    });

    const response = await handleRunRequest(() =>
      handleCreateProject(
        jsonRequest({ name: "Demo", workspaceRoot: "/workspace/demo" }),
        service,
      ),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "workspace_root_registered" },
    });
  });
});
