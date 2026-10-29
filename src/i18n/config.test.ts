import { describe, expect, it } from "vitest";
import { defaultLocale, getDirection, isLocale, locales } from "./config";

describe("locale config", () => {
  it("defaults to English", () => {
    expect(defaultLocale).toBe("en");
  });

  it("maps every locale to the correct direction", () => {
    expect(getDirection("fa")).toBe("rtl");
    expect(getDirection("en")).toBe("ltr");
  });

  it("accepts supported locales only", () => {
    for (const locale of locales) {
      expect(isLocale(locale)).toBe(true);
    }

    expect(isLocale("ar")).toBe(false);
    expect(isLocale("")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});
