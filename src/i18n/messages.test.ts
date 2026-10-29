import { describe, expect, it } from "vitest";
import { en, fa, getMessages } from "./messages";

function flattenEntries(
  value: unknown,
  prefix = "",
): Array<[string, string]> {
  if (typeof value === "string") {
    return [[prefix, value]];
  }

  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) =>
      flattenEntries(child, prefix ? `${prefix}.${key}` : key),
    );
  }

  return [];
}

const englishEntries = flattenEntries(en);
const persianEntries = flattenEntries(fa);

describe("translation catalogs", () => {
  it("define exactly the same keys", () => {
    expect(persianEntries.map(([key]) => key)).toEqual(
      englishEntries.map(([key]) => key),
    );
  });

  it("contain no empty strings", () => {
    for (const [key, value] of persianEntries) {
      expect(value.trim(), `fa.${key}`).not.toBe("");
    }

    for (const [key, value] of englishEntries) {
      expect(value.trim(), `en.${key}`).not.toBe("");
    }
  });

  it("translate prose instead of copying it", () => {
    expect(fa.home.title).not.toBe(en.home.title);
    expect(fa.states.errorTitle).not.toBe(en.states.errorTitle);
    expect(fa.home.title).toMatch(/[\u0600-\u06FF]/);
  });

  it("keep the product brand unchanged", () => {
    expect(fa.nav.brand).toBe("DominoAI");
    expect(en.nav.brand).toBe("DominoAI");
  });

  it("return the catalog for a locale", () => {
    expect(getMessages("fa")).toBe(fa);
    expect(getMessages("en")).toBe(en);
  });
});
