import { describe, expect, it } from "vitest";
import { handleRunRequest } from "../../../../../lib/runs/http";
import { RunServiceError } from "../../../../../lib/runs/service";
import {
  SAMPLE_DETAIL,
  runServiceWith,
} from "../../../../../lib/runs/test-support";
import { handlePauseRun } from "./route";

describe("POST /api/runs/[id]/pause", () => {
  it("requests a pause without waiting for completion", async () => {
    let received: string | null = null;
    const service = runServiceWith({
      pauseRun: async (id) => {
        received = id;
        return SAMPLE_DETAIL;
      },
    });

    const response = await handlePauseRun("run-1", service);

    expect(response.status).toBe(200);
    expect(received).toBe("run-1");
    await expect(response.json()).resolves.toEqual({ run: SAMPLE_DETAIL });
  });

  it("maps a state conflict to 409", async () => {
    const service = runServiceWith({
      pauseRun: async () => {
        throw new RunServiceError("run_state_conflict");
      },
    });

    const response = await handleRunRequest(() =>
      handlePauseRun("run-1", service),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "run_state_conflict" },
    });
  });
});
