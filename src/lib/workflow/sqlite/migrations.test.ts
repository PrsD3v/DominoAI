import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkflowPersistenceError } from "../persistence-errors";
import {
  SCHEMA_VERSION,
  applyMigrations,
  openSqliteDatabase,
} from "./migrations";

const directories: string[] = [];

async function makeDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "domino-sqlite-migrations-"));
  directories.push(directory);
  return directory;
}

async function makeDatabasePath(): Promise<string> {
  return join(await makeDirectory(), "domino.db");
}

const TABLES = [
  "approvals",
  "project_skill_versions",
  "project_workflow_versions",
  "projects",
  "runtime_events",
  "runtime_profiles",
  "runtime_session_refs",
  "skill_definitions",
  "skill_versions",
  "step_runs",
  "workflow_definitions",
  "workflow_history",
  "workflow_runs",
  "workflow_versions",
];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("openSqliteDatabase", () => {
  it("creates the full schema and reports the latest version", async () => {
    const path = await makeDatabasePath();
    const database = openSqliteDatabase({ path });

    try {
      const version = database.db.prepare("PRAGMA user_version").get();
      expect(Number(version?.user_version)).toBe(SCHEMA_VERSION);

      const rows = database.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all();
      expect(rows.map((row) => String(row.name))).toEqual(TABLES);
    } finally {
      database.close();
    }
  });

  it("re-opens an existing database without rerunning migrations", async () => {
    const path = await makeDatabasePath();

    const first = openSqliteDatabase({ path });
    first.db
      .prepare("INSERT INTO workflow_definitions (id, name) VALUES (?, ?)")
      .run("definition-1", "Release");
    first.close();

    const second = openSqliteDatabase({ path });

    try {
      const version = second.db.prepare("PRAGMA user_version").get();
      expect(Number(version?.user_version)).toBe(SCHEMA_VERSION);

      const rows = second.db
        .prepare("SELECT id FROM workflow_definitions")
        .all();
      expect(rows).toEqual([{ id: "definition-1" }]);
    } finally {
      second.close();
    }
  });

  it("upgrades a version 1 database and preserves existing rows", async () => {
    const path = await makeDatabasePath();

    const created = openSqliteDatabase({ path });
    created.db
      .prepare("INSERT INTO workflow_definitions (id, name) VALUES (?, ?)")
      .run("definition-1", "Release");
    created.db.exec("DROP TABLE runtime_profiles");
    created.db.exec("ALTER TABLE workflow_runs DROP COLUMN project_id");
    created.db.exec(
      "ALTER TABLE workflow_runs DROP COLUMN workflow_version_id",
    );
    created.db.exec("PRAGMA user_version = 1");
    created.close();

    const upgraded = openSqliteDatabase({ path });

    try {
      const version = upgraded.db.prepare("PRAGMA user_version").get();
      expect(Number(version?.user_version)).toBe(SCHEMA_VERSION);

      const profileTable = upgraded.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'runtime_profiles'",
        )
        .all();
      expect(profileTable).toEqual([{ name: "runtime_profiles" }]);

      const definitions = upgraded.db
        .prepare("SELECT id FROM workflow_definitions")
        .all();
      expect(definitions).toEqual([{ id: "definition-1" }]);
    } finally {
      upgraded.close();
    }
  });

  it("upgrades a version 2 database and preserves existing runs", async () => {
    const path = await makeDatabasePath();
    const created = openSqliteDatabase({ path });

    created.db
      .prepare(
        `INSERT INTO workflow_runs (
          id, workflow_id, workflow_version, plan_json, runtime_profile_id,
          workspace_root, status, created_at, updated_at, started_at,
          finished_at, pause_requested, cancel_requested, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "run-1",
        "workflow-1",
        1,
        JSON.stringify({
          workflowId: "workflow-1",
          workflowVersion: 1,
          steps: [{ key: "step-1", prompt: "Do the work" }],
        }),
        "profile-opaque",
        "/workspace",
        "completed",
        "2026-10-30T00:00:00.000Z",
        "2026-10-30T00:00:00.000Z",
        "2026-10-30T00:00:00.000Z",
        "2026-10-30T00:00:01.000Z",
        0,
        0,
        null,
      );
    created.db.exec("ALTER TABLE workflow_runs DROP COLUMN project_id");
    created.db.exec(
      "ALTER TABLE workflow_runs DROP COLUMN workflow_version_id",
    );
    created.db.exec("PRAGMA user_version = 2");
    created.close();

    const upgraded = openSqliteDatabase({ path });

    try {
      const version = upgraded.db.prepare("PRAGMA user_version").get();
      expect(Number(version?.user_version)).toBe(SCHEMA_VERSION);

      const columns = upgraded.db
        .prepare("PRAGMA table_info(workflow_runs)")
        .all()
        .map((row) => String(row.name));
      expect(columns).toContain("project_id");
      expect(columns).toContain("workflow_version_id");

      const row = upgraded.db
        .prepare("SELECT * FROM workflow_runs WHERE id = ?")
        .get("run-1");
      expect(row?.project_id).toBeNull();
      expect(row?.workflow_version_id).toBeNull();
    } finally {
      upgraded.close();
    }
  });

  it("enables foreign key enforcement", async () => {
    const database = openSqliteDatabase({ path: await makeDatabasePath() });

    try {
      const pragma = database.db.prepare("PRAGMA foreign_keys").get();
      expect(Number(pragma?.foreign_keys)).toBe(1);
    } finally {
      database.close();
    }
  });

  it("supports an in-memory database", () => {
    const database = openSqliteDatabase({ path: ":memory:" });

    try {
      const rows = database.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workflow_runs'",
        )
        .all();
      expect(rows).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("closes once even when close is called twice", async () => {
    const database = openSqliteDatabase({ path: await makeDatabasePath() });

    expect(() => {
      database.close();
      database.close();
    }).not.toThrow();
  });

  it("refuses a database written by a newer schema", async () => {
    const path = await makeDatabasePath();

    const created = openSqliteDatabase({ path });
    created.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    created.close();

    expect(() => openSqliteDatabase({ path })).toThrowError(
      WorkflowPersistenceError,
    );
    expect(() => openSqliteDatabase({ path })).toThrow(
      `The database schema version ${SCHEMA_VERSION + 1} is newer than the supported version ${SCHEMA_VERSION}`,
    );
  });

  it("reports the newer-schema refusal with the schema code", async () => {
    const path = await makeDatabasePath();

    const created = openSqliteDatabase({ path });
    created.db.exec("PRAGMA user_version = 99");
    created.close();

    try {
      openSqliteDatabase({ path });
      throw new Error("expected the open to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowPersistenceError);
      expect((error as WorkflowPersistenceError).code).toBe("schema");
    }
  });

  it("leaves an applied migration recorded when it runs again", async () => {
    const path = await makeDatabasePath();
    const database = openSqliteDatabase({ path });

    try {
      expect(() => applyMigrations(database.db)).not.toThrow();

      const version = database.db.prepare("PRAGMA user_version").get();
      expect(Number(version?.user_version)).toBe(SCHEMA_VERSION);
    } finally {
      database.close();
    }
  });
});
