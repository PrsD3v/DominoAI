import { describe, expect, it } from "vitest";
import { handleRunRequest } from "../../../../../lib/runs/http";
import { RunServiceError } from "../../../../../lib/runs/service";
import {
  SAMPLE_DETAIL,
  runServiceWith,
} from "../../../../../lib/runs/test-support";
import { handleRunEvents } from "./route";

function streamRequest(signal: AbortSignal): Request {
  return new Request("http://localhost/api/runs/run-1/events", { signal });
}

describe("GET /api/runs/[id]/events", () => {
  it("returns an SSE response starting with a snapshot", async () => {
    const controller = new AbortController();
    const service = runServiceWith({
      getRun: async () => SAMPLE_DETAIL,
      getState: async () => ({
        run: SAMPLE_DETAIL.run,
        steps: SAMPLE_DETAIL.steps,
        approvals: SAMPLE_DETAIL.approvals,
        history: SAMPLE_DETAIL.history,
      }),
      listRuntimeEvents: async () => [],
    });

    const response = await handleRunEvents(
      streamRequest(controller.signal),
      "run-1",
      service,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("cache-control")).toBe(
      "no-cache, no-transform",
    );
    expect(response.body).not.toBeNull();

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";

    for (let index = 0; index < 3 && !text.includes("event: snapshot"); index += 1) {
      const chunk = await reader.read();

      if (chunk.done) {
        break;
      }

      text += decoder.decode(chunk.value);
    }

    expect(text).toContain("event: snapshot");
    controller.abort();
    await reader.cancel().catch(() => {});
  });

  it("returns a JSON 404 before streaming for a missing run", async () => {
    const service = runServiceWith({
      getRun: async () => {
        throw new RunServiceError("run_not_found");
      },
    });

    const response = await handleRunRequest(() =>
      handleRunEvents(
        streamRequest(new AbortController().signal),
        "missing-run",
        service,
      ),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "run_not_found" },
    });
  });
});
