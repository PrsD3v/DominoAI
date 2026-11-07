import { describe, expect, it } from "vitest";
import { handleRunRequest } from "../../../../lib/runs/http";
import { RunServiceError } from "../../../../lib/runs/service";
import {
  SAMPLE_DETAIL,
  runServiceWith,
} from "../../../../lib/runs/test-support";
import { handleGetRun } from "./route";

describe("GET /api/runs/[id]", () => {
  it("returns one run detail", async () => {
    const service = runServiceWith({
      getRun: async () => SAMPLE_DETAIL,
    });

    const response = await handleGetRun("run-1", service);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ run: SAMPLE_DETAIL });
  });

  it("maps a missing run to 404", async () => {
    const service = runServiceWith({
      getRun: async () => {
        throw new RunServiceError("run_not_found");
      },
    });

    const response = await handleRunRequest(() =>
      handleGetRun("missing-run", service),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "run_not_found" },
    });
  });
});
