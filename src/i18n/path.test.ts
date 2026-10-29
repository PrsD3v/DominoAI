import { describe, expect, it } from "vitest";
import { localeFromPath, swapLocaleInPath } from "./path";

describe("locale routing", () => {
  it("switches the locale segment and preserves the rest of the path", () => {
    expect(swapLocaleInPath("/fa", "en")).toBe("/en");
    expect(swapLocaleInPath("/en/runs/1", "fa")).toBe("/fa/runs/1");
    expect(swapLocaleInPath("/fa/projects/abc", "en")).toBe("/en/projects/abc");
  });

  it("adds a locale segment when the path has none", () => {
    expect(swapLocaleInPath("/", "en")).toBe("/en");

    expect(swapLocaleInPath("/runs/1", "en")).toBe("/en/runs/1");
  });

  it("reads the locale from a path with a fallback", () => {
    expect(localeFromPath("/fa/runs")).toBe("fa");
    expect(localeFromPath("/en")).toBe("en");
    expect(localeFromPath("/runs")).toBe("en");
    expect(localeFromPath("/")).toBe("en");
  });
});
