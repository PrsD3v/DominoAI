import { describe, expect, it } from "vitest";
import { handleRunRequest } from "../../../lib/runs/http";
import { RunServiceError } from "../../../lib/runs/service";
import {
  SAMPLE_DETAIL,
  SAMPLE_RUN,
  runServiceWith,
} from "../../../lib/runs/test-support";
import { handleListRuns, handleStartRun } from "./route";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/runs", () => {
  it("returns run summaries", async () => {
    const service = runServiceWith({
      listRuns: async () => [SAMPLE_RUN],
    });

    const response = await handleListRuns(service);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ runs: [SAMPLE_RUN] });
  });

  it("returns an empty collection", async () => {
    const service = runServiceWith({ listRuns: async () => [] });

    const response = await handleListRuns(service);

    await expect(response.json()).resolves.toEqual({ runs: [] });
  });
});

describe("POST /api/runs", () => {
  it("starts a run before completion", async () => {
    let received: unknown;
    const service = runServiceWith({
      startRun: async (input) => {
        received = input;
        return SAMPLE_DETAIL;
      },
    });
    const body = {
      projectId: "project-1",
      workflowVersionId: "workflow-version-1",
    };

    const response = await handleStartRun(jsonRequest(body), service);

    expect(response.status).toBe(201);
    expect(received).toEqual(body);
    await expect(response.json()).resolves.toEqual({ run: SAMPLE_DETAIL });
  });

  it("requires a JSON content type", async () => {
    const service = runServiceWith({});

    const response = await handleRunRequest(() =>
      handleStartRun(
        new Request("http://localhost/api/runs", {
          method: "POST",
          body: JSON.stringify({}),
        }),
        service,
      ),
    );

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unsupported_media_type" },
    });
  });

  it("rejects an unreadable body", async () => {
    const service = runServiceWith({});

    const response = await handleRunRequest(() =>
      handleStartRun(
        new Request("http://localhost/api/runs", {
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

  it("maps a busy run conflict", async () => {
    const service = runServiceWith({
      startRun: async () => {
        throw new RunServiceError("run_busy");
      },
    });

    const response = await handleRunRequest(() =>
      handleStartRun(
        jsonRequest({
          projectId: "project-1",
          workflowVersionId: "workflow-version-1",
        }),
        service,
      ),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "run_busy" },
    });
  });
});
