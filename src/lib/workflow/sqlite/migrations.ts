import { DatabaseSync } from "node:sqlite";
import { WorkflowPersistenceError } from "../persistence-errors";

/** Latest schema version this build can read and write. */
export const SCHEMA_VERSION = 1;

interface Migration {
  readonly version: number;
  readonly statements: readonly string[];
}

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE workflow_definitions (
        id TEXT NOT NULL PRIMARY KEY,
        name TEXT NOT NULL
      )`,
      `CREATE TABLE skill_definitions (
        id TEXT NOT NULL PRIMARY KEY,
        name TEXT NOT NULL
      )`,
      `CREATE TABLE workflow_versions (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        definition_id TEXT NOT NULL REFERENCES workflow_definitions (id),
        version INTEGER NOT NULL,
        steps_json TEXT NOT NULL,
        approval_points_json TEXT NOT NULL,
        error_policy TEXT NOT NULL,
        published_at TEXT NOT NULL,
        UNIQUE (definition_id, version)
      )`,
      `CREATE TABLE skill_versions (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        skill_definition_id TEXT NOT NULL REFERENCES skill_definitions (id),
        version INTEGER NOT NULL,
        content TEXT NOT NULL,
        published_at TEXT NOT NULL,
        UNIQUE (skill_definition_id, version)
      )`,
      `CREATE TABLE projects (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        workspace_root TEXT NOT NULL,
        configuration_json TEXT NOT NULL,
        default_runtime_profile_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE project_workflow_versions (
        project_id TEXT NOT NULL REFERENCES projects (id),
        workflow_version_id TEXT NOT NULL REFERENCES workflow_versions (id),
        position INTEGER NOT NULL,
        PRIMARY KEY (project_id, workflow_version_id)
      )`,
      `CREATE INDEX project_workflow_versions_project
        ON project_workflow_versions (project_id, position)`,
      `CREATE TABLE project_skill_versions (
        project_id TEXT NOT NULL REFERENCES projects (id),
        skill_version_id TEXT NOT NULL REFERENCES skill_versions (id),
        position INTEGER NOT NULL,
        PRIMARY KEY (project_id, skill_version_id)
      )`,
      `CREATE INDEX project_skill_versions_project
        ON project_skill_versions (project_id, position)`,
      `CREATE TABLE workflow_runs (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        workflow_id TEXT NOT NULL,
        workflow_version INTEGER NOT NULL,
        plan_json TEXT NOT NULL,
        runtime_profile_id TEXT NOT NULL,
        workspace_root TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        pause_requested INTEGER NOT NULL,
        cancel_requested INTEGER NOT NULL,
        error TEXT
      )`,
      `CREATE TABLE step_runs (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        run_id TEXT NOT NULL REFERENCES workflow_runs (id),
        step_key TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        result_text TEXT,
        error TEXT
      )`,
      `CREATE INDEX step_runs_run ON step_runs (run_id, seq)`,
      `CREATE TABLE approvals (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        run_id TEXT NOT NULL REFERENCES workflow_runs (id),
        step_run_id TEXT NOT NULL REFERENCES step_runs (id),
        status TEXT NOT NULL,
        message TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        resolved_at TEXT,
        response TEXT
      )`,
      `CREATE INDEX approvals_run ON approvals (run_id, seq)`,
      `CREATE TABLE runtime_session_refs (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        run_id TEXT NOT NULL REFERENCES workflow_runs (id),
        step_run_id TEXT NOT NULL REFERENCES step_runs (id),
        runtime_session_id TEXT NOT NULL,
        agent_name TEXT,
        created_at TEXT NOT NULL,
        closed_at TEXT,
        close_error TEXT
      )`,
      `CREATE INDEX runtime_session_refs_run ON runtime_session_refs (run_id, seq)`,
      `CREATE TABLE runtime_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        run_id TEXT NOT NULL REFERENCES workflow_runs (id),
        step_run_id TEXT NOT NULL REFERENCES step_runs (id),
        event_json TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      )`,
      `CREATE INDEX runtime_events_run ON runtime_events (run_id, seq)`,
      `CREATE TABLE workflow_history (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        run_id TEXT NOT NULL REFERENCES workflow_runs (id),
        step_run_id TEXT REFERENCES step_runs (id),
        kind TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX workflow_history_run ON workflow_history (run_id, seq)`,
    ],
  },
];

function readUserVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get();
  const value = row?.user_version;

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new WorkflowPersistenceError(
      "schema",
      "The database does not report a readable schema version",
    );
  }

  return value;
}

/**
 * Bring the database up to `SCHEMA_VERSION`, one immutable migration per
 * version, each applied inside its own transaction. A database written by a
 * newer build is refused instead of being used with an unknown schema.
 */
export function applyMigrations(db: DatabaseSync): void {
  const current = readUserVersion(db);

  if (current > SCHEMA_VERSION) {
    throw new WorkflowPersistenceError(
      "schema",
      `The database schema version ${current} is newer than the supported version ${SCHEMA_VERSION}`,
    );
  }

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) {
      continue;
    }

    db.exec("BEGIN IMMEDIATE");

    try {
      for (const statement of migration.statements) {
        db.exec(statement);
      }

      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

/** An open, migrated database with an idempotent close. */
export interface SqliteDatabase {
  readonly db: DatabaseSync;
  close(): void;
}

/** Where to open the local database. `:memory:` is supported for tests. */
export interface OpenSqliteDatabaseOptions {
  readonly path: string;
}

/** Open a local SQLite database and apply pending migrations. */
export function openSqliteDatabase(
  options: OpenSqliteDatabaseOptions,
): SqliteDatabase {
  const db = new DatabaseSync(options.path, {
    enableForeignKeyConstraints: true,
  });

  try {
    applyMigrations(db);
  } catch (error) {
    db.close();
    throw error;
  }

  let closed = false;

  return {
    db,
    close(): void {
      if (!closed) {
        closed = true;
        db.close();
      }
    },
  };
}
