import { afterEach, describe, expect, it, vi } from "vitest";
import { handleRunRequest } from "./http";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("run error logging", () => {
  it("logs an unexpected failure once with a redacted message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      handleRunRequest(async () => {
        throw new Error("failed with sk-test-secret-value");
      }),
    ).rejects.toThrow("failed with sk-test-secret-value");

    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0]?.[0] as string;
    expect(line).toContain("[redacted]");
    expect(line).not.toContain("sk-test-secret-value");
  });
});
