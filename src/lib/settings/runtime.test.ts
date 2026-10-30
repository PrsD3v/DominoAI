import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSettingsServiceFromEnvironment,
  resolveSettingsPaths,
} from "./runtime";

const directories: string[] = [];

async function makeRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "domino-settings-runtime-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("settings paths", () => {
  it("uses the local defaults", () => {
    expect(resolveSettingsPaths({}, "/home/user", "/work/domino")).toEqual({
      databasePath: "/work/domino/.domino/domino.db",
      reasonixHome: "/home/user/.reasonix",
      reasonixBin: "reasonix",
    });
  });

  it("uses environment overrides", () => {
    expect(
      resolveSettingsPaths(
        {
          DOMINO_DB_PATH: "/data/domino.db",
          DOMINO_REASONIX_HOME: "/srv/reasonix",
          DOMINO_REASONIX_BIN: "/opt/reasonix/bin/reasonix",
        },
        "/home/user",
        "/work/domino",
      ),
    ).toEqual({
      databasePath: "/data/domino.db",
      reasonixHome: "/srv/reasonix",
      reasonixBin: "/opt/reasonix/bin/reasonix",
    });
  });

  it("treats empty and whitespace-only values as unset", () => {
    expect(
      resolveSettingsPaths(
        {
          DOMINO_DB_PATH: "   ",
          DOMINO_REASONIX_HOME: "",
          DOMINO_REASONIX_BIN: "\t",
        },
        "/home/user",
        "/work/domino",
      ),
    ).toEqual({
      databasePath: "/work/domino/.domino/domino.db",
      reasonixHome: "/home/user/.reasonix",
      reasonixBin: "reasonix",
    });
  });

  it("resolves relative paths against their bases", () => {
    expect(
      resolveSettingsPaths(
        {
          DOMINO_DB_PATH: "state/settings.db",
          DOMINO_REASONIX_HOME: "reasonix-home",
          DOMINO_REASONIX_BIN: "bin/reasonix",
        },
        "/home/user",
        "/work/domino",
      ),
    ).toEqual({
      databasePath: "/work/domino/state/settings.db",
      reasonixHome: "/home/user/reasonix-home",
      reasonixBin: "bin/reasonix",
    });
  });
});

describe("settings service from environment", () => {
  it("creates the database directory privately and opens the store", async () => {
    const root = await makeRoot();
    const stateDirectory = join(root, "state");
    const service = createSettingsServiceFromEnvironment(
      {
        DOMINO_DB_PATH: join(stateDirectory, "domino.db"),
        DOMINO_REASONIX_HOME: join(root, "reasonix"),
      },
      root,
      root,
    );

    await expect(service.listProfiles()).resolves.toEqual([]);

    const stateStats = await stat(stateDirectory);
    expect(stateStats.isDirectory()).toBe(true);
    expect(stateStats.mode & 0o777).toBe(0o700);

    const databaseStats = await stat(join(stateDirectory, "domino.db"));
    expect(databaseStats.isFile()).toBe(true);
  });
});
