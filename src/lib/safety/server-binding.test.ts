import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

interface PackageJson {
  readonly scripts?: Record<string, string>;
}

async function readScripts(): Promise<Record<string, string>> {
  const text = await readFile(
    new URL("../../../package.json", import.meta.url),
    "utf8",
  );
  const parsed = JSON.parse(text) as PackageJson;

  return parsed.scripts ?? {};
}

describe("server binding", () => {
  it("binds the development server to loopback by default", async () => {
    expect((await readScripts()).dev).toBe("next dev -H 127.0.0.1");
  });

  it("binds the production server to loopback by default", async () => {
    expect((await readScripts()).start).toBe("next start -H 127.0.0.1");
  });
});
