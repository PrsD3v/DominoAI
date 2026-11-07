import { describe, expect, it } from "vitest";
import { handleRunRequest } from "../../../../../lib/runs/http";
import { RunServiceError } from "../../../../../lib/runs/service";
import {
  SAMPLE_DETAIL,
  runServiceWith,
} from "../../../../../lib/runs/test-support";
import { handleCancelRun } from "./route";

describe("POST /api/runs/[id]/cancel", () => {
  it("requests a cancel without waiting for completion", async () => {
    let received: string | null = null;
    const service = runServiceWith({
      cancelRun: async (id) => {
        received = id;
        return SAMPLE_DETAIL;
      },
    });

    const response = await handleCancelRun("run-1", service);

    expect(response.status).toBe(200);
    expect(received).toBe("run-1");
    await expect(response.json()).resolves.toEqual({ run: SAMPLE_DETAIL });
  });

  it("maps a state conflict to 409", async () => {
    const service = runServiceWith({
      cancelRun: async () => {
        throw new RunServiceError("run_state_conflict");
      },
    });

    const response = await handleRunRequest(() =>
      handleCancelRun("run-1", service),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "run_state_conflict" },
    });
  });
});
