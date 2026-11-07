import { describe, expect, it } from "vitest";
import { handleRunRequest } from "../../../../../../lib/runs/http";
import { RunServiceError } from "../../../../../../lib/runs/service";
import {
  SAMPLE_DETAIL,
  runServiceWith,
} from "../../../../../../lib/runs/test-support";
import { handleAnswerApproval } from "./route";

function jsonRequest(body: unknown): Request {
  return new Request(
    "http://localhost/api/runs/run-1/approvals/approval-1",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("POST /api/runs/[id]/approvals/[approvalId]", () => {
  it("answers one approval", async () => {
    let received:
      | { id: string; approvalId: string; input: unknown }
      | undefined;
    const service = runServiceWith({
      answerApproval: async (id, approvalId, input) => {
        received = { id, approvalId, input };
        return SAMPLE_DETAIL;
      },
    });

    const response = await handleAnswerApproval(
      "run-1",
      "approval-1",
      jsonRequest({ decision: "approve" }),
      service,
    );

    expect(response.status).toBe(200);
    expect(received).toEqual({
      id: "run-1",
      approvalId: "approval-1",
      input: { decision: "approve" },
    });
    await expect(response.json()).resolves.toEqual({ run: SAMPLE_DETAIL });
  });

  it("requires a JSON content type", async () => {
    const service = runServiceWith({});

    const response = await handleRunRequest(() =>
      handleAnswerApproval(
        "run-1",
        "approval-1",
        new Request(
          "http://localhost/api/runs/run-1/approvals/approval-1",
          { method: "POST", body: JSON.stringify({ decision: "approve" }) },
        ),
        service,
      ),
    );

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unsupported_media_type" },
    });
  });

  it("maps an unknown approval to 404", async () => {
    const service = runServiceWith({
      answerApproval: async () => {
        throw new RunServiceError("approval_not_found");
      },
    });

    const response = await handleRunRequest(() =>
      handleAnswerApproval(
        "run-1",
        "missing-approval",
        jsonRequest({ decision: "reject" }),
        service,
      ),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "approval_not_found" },
    });
  });

  it("maps an already answered approval to 409", async () => {
    const service = runServiceWith({
      answerApproval: async () => {
        throw new RunServiceError("approval_already_resolved");
      },
    });

    const response = await handleRunRequest(() =>
      handleAnswerApproval(
        "run-1",
        "approval-1",
        jsonRequest({ decision: "approve" }),
        service,
      ),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "approval_already_resolved" },
    });
  });
});
