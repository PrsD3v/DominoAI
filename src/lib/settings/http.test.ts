import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleSettingsRequest,
  settingsErrorResponse,
  settingsJsonResponse,
} from "./http";
import { SettingsError } from "./service";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("settings response redaction", () => {
  it("redacts secret-shaped success values", async () => {
    const response = settingsJsonResponse({
      profile: { label: "api_key=abcd1234" },
      model: "sk-test-secret-value",
    });

    await expect(response.json()).resolves.toEqual({
      profile: { label: "api_key=[redacted]" },
      model: "[redacted]",
    });
  });

  it("redacts secret-shaped field errors", async () => {
    const response = settingsErrorResponse(
      new SettingsError("invalid_request", [
        { field: "label", message: "sk-test-secret-value" },
      ]),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.fields).toEqual([
      { field: "label", message: "[redacted]" },
    ]);
  });

  it("logs an unexpected failure once with a redacted message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      handleSettingsRequest(async () => {
        throw new Error("failed with sk-test-secret-value");
      }),
    ).rejects.toThrow("failed with sk-test-secret-value");

    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0]?.[0] as string;
    expect(line).toContain("[redacted]");
    expect(line).not.toContain("sk-test-secret-value");
  });
});
