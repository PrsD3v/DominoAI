import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { ReasonixEnvFileStore } from "../runtime/reasonix/env-file-store";
import {
  loadReasonixProviderCatalog,
  runReasonixDoctor,
} from "../runtime/reasonix/provider-catalog";
import { openSqliteWorkflowStore } from "../workflow/sqlite/sqlite-store";
import { createSettingsService, type SettingsService } from "./service";

/** Environment names that configure the local settings API. */
export interface SettingsEnvironment {
  readonly [name: string]: string | undefined;
  readonly DOMINO_DB_PATH?: string;
  readonly DOMINO_REASONIX_HOME?: string;
  readonly DOMINO_REASONIX_BIN?: string;
}

export interface SettingsPaths {
  readonly databasePath: string;
  readonly reasonixHome: string;
  readonly reasonixBin: string;
}

const DEFAULT_DATABASE_PATH = join(".domino", "domino.db");
const DEFAULT_REASONIX_HOME = ".reasonix";
const DEFAULT_REASONIX_BIN = "reasonix";

function configured(value: string | undefined): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** Resolve the local paths from environment variables and their defaults. */
export function resolveSettingsPaths(
  env: SettingsEnvironment,
  homeDir: string,
  cwd: string,
): SettingsPaths {
  return {
    databasePath: resolve(
      cwd,
      configured(env.DOMINO_DB_PATH) ?? DEFAULT_DATABASE_PATH,
    ),
    reasonixHome: resolve(
      homeDir,
      configured(env.DOMINO_REASONIX_HOME) ?? DEFAULT_REASONIX_HOME,
    ),
    reasonixBin: configured(env.DOMINO_REASONIX_BIN) ?? DEFAULT_REASONIX_BIN,
  };
}

/**
 * Build a service from the local environment. The database parent is created
 * privately before SQLite opens the file. No credential is read here.
 */
export function createSettingsServiceFromEnvironment(
  env: SettingsEnvironment = process.env,
  homeDir: string = homedir(),
  cwd: string = process.cwd(),
): SettingsService {
  const paths = resolveSettingsPaths(env, homeDir, cwd);

  mkdirSync(dirname(paths.databasePath), { recursive: true, mode: 0o700 });

  const store = openSqliteWorkflowStore({ path: paths.databasePath });
  const credentials = new ReasonixEnvFileStore({
    homeDir: paths.reasonixHome,
  });

  return createSettingsService({
    profiles: store,
    credentials,
    loadCatalog: () =>
      loadReasonixProviderCatalog(() =>
        runReasonixDoctor(paths.reasonixBin),
      ),
  });
}

const globalForSettings = globalThis as typeof globalThis & {
  __dominoSettingsService?: SettingsService;
};

/** Return the single process-wide settings service, opening it on first use. */
export function getSettingsService(): SettingsService {
  if (globalForSettings.__dominoSettingsService === undefined) {
    globalForSettings.__dominoSettingsService =
      createSettingsServiceFromEnvironment();
  }

  return globalForSettings.__dominoSettingsService;
}
