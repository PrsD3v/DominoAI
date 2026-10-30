import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RuntimeProfile } from "../../../types/runtime-settings";
import {
  WorkflowPersistenceError,
  WorkflowRecordError,
} from "../persistence-errors";
import { openSqliteDatabase } from "./migrations";
import {
  openSqliteWorkflowStore,
  type SqliteWorkflowStore,
} from "./sqlite-store";

const directories: string[] = [];
const stores: SqliteWorkflowStore[] = [];

async function makePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "domino-runtime-profiles-"));
  directories.push(directory);
  return join(directory, "domino.db");
}

function openStore(path: string): SqliteWorkflowStore {
  const store = openSqliteWorkflowStore({ path });
  stores.push(store);
  return store;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("expected the promise to reject");
}

function baseProfile(overrides: Partial<RuntimeProfile> = {}): RuntimeProfile {
  return {
    id: "profile-1",
    label: "Reasonix default",
    adapterId: "reasonix",
    providerName: "deepseek",
    model: "deepseek-flash",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    credentialRef: {
      kind: "reasonix-env",
      providerName: "deepseek",
      apiKeyEnv: "DEEPSEEK_API_KEY",
    },
    createdAt: "2026-10-30T00:00:00.000Z",
    updatedAt: "2026-10-30T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(async () => {
  for (const store of stores.splice(0)) {
    store.close();
  }

  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("SQLite runtime profile persistence", () => {
  it("round-trips a profile and reconstructs credentialRef", async () => {
    const store = openStore(await makePath());
    const profile = baseProfile();

    await store.createRuntimeProfile(profile);

    const stored = await store.getRuntimeProfile("profile-1");
    expect(stored).toEqual(profile);
    expect(stored?.credentialRef).not.toBe(profile.credentialRef);
  });

  it("returns null for an unknown profile", async () => {
    const store = openStore(await makePath());

    expect(await store.getRuntimeProfile("missing")).toBeNull();
  });

  it("updates a stored profile", async () => {
    const store = openStore(await makePath());
    await store.createRuntimeProfile(baseProfile());

    const updated: RuntimeProfile = {
      ...baseProfile(),
      label: "Reasonix production",
      providerName: "openrouter",
      model: "z-ai/glm-4.6",
      apiKeyEnv: "OPENROUTER_API_KEY",
      credentialRef: {
        kind: "reasonix-env",
        providerName: "openrouter",
        apiKeyEnv: "OPENROUTER_API_KEY",
      },
      updatedAt: "2026-10-30T01:00:00.000Z",
    };
    await store.updateRuntimeProfile(updated);

    expect(await store.getRuntimeProfile("profile-1")).toEqual(updated);
  });

  it("rejects an invalid update and keeps the stored profile", async () => {
    const store = openStore(await makePath());
    const profile = baseProfile();
    await store.createRuntimeProfile(profile);

    const invalid = { ...profile, providerName: "" } as RuntimeProfile;
    const error = await rejection(store.updateRuntimeProfile(invalid));

    expect(error).toBeInstanceOf(WorkflowPersistenceError);
    expect((error as WorkflowPersistenceError).code).toBe("invalid");
    expect(await store.getRuntimeProfile("profile-1")).toEqual(profile);
  });

  it("rejects a duplicate profile id", async () => {
    const store = openStore(await makePath());
    await store.createRuntimeProfile(baseProfile());

    const error = await rejection(store.createRuntimeProfile(baseProfile()));

    expect(error).toBeInstanceOf(WorkflowRecordError);
    expect((error as WorkflowRecordError).operation).toBe("create");
    expect((error as WorkflowRecordError).recordKind).toBe("runtime profile");
    expect((error as WorkflowRecordError).id).toBe("profile-1");
  });

  it("rejects an update for a missing profile", async () => {
    const store = openStore(await makePath());

    const error = await rejection(
      store.updateRuntimeProfile(baseProfile({ id: "missing" })),
    );

    expect(error).toBeInstanceOf(WorkflowRecordError);
    expect((error as WorkflowRecordError).operation).toBe("update");
    expect((error as WorkflowRecordError).recordKind).toBe("runtime profile");
    expect((error as WorkflowRecordError).id).toBe("missing");
  });

  it("rejects invalid input and writes nothing", async () => {
    const store = openStore(await makePath());
    const emptyId = { ...baseProfile(), id: "" } as RuntimeProfile;

    const emptyIdError = await rejection(store.createRuntimeProfile(emptyId));
    expect(emptyIdError).toBeInstanceOf(WorkflowPersistenceError);
    expect((emptyIdError as WorkflowPersistenceError).code).toBe("invalid");
    expect(await store.getRuntimeProfile("")).toBeNull();

    const secretBearing = {
      ...baseProfile(),
      apiKey: "sk-test-secret",
    } as unknown as RuntimeProfile;

    const secretError = await rejection(
      store.createRuntimeProfile(secretBearing),
    );
    expect(secretError).toBeInstanceOf(WorkflowPersistenceError);
    expect((secretError as WorkflowPersistenceError).code).toBe("invalid");
    expect(await store.getRuntimeProfile("profile-1")).toBeNull();
  });

  it("rejects a corrupt stored row with a decode error", async () => {
    const path = await makePath();
    const store = openStore(path);
    await store.createRuntimeProfile(baseProfile());
    store.close();

    const database = openSqliteDatabase({ path });
    database.db
      .prepare("UPDATE runtime_profiles SET credential_kind = ? WHERE id = ?")
      .run("other", "profile-1");
    database.close();

    const reopened = openStore(path);
    const error = await rejection(reopened.getRuntimeProfile("profile-1"));

    expect(error).toBeInstanceOf(WorkflowPersistenceError);
    expect((error as WorkflowPersistenceError).code).toBe("decode");
  });

  it("exposes only non-secret profile columns", async () => {
    const path = await makePath();
    const store = openStore(path);
    await store.createRuntimeProfile(baseProfile());
    store.close();

    const database = openSqliteDatabase({ path });

    try {
      const columns = database.db
        .prepare("PRAGMA table_info(runtime_profiles)")
        .all()
        .map((row) => String(row.name));

      expect(columns).toEqual([
        "id",
        "label",
        "adapter_id",
        "provider_name",
        "model",
        "api_key_env",
        "credential_kind",
        "created_at",
        "updated_at",
      ]);
    } finally {
      database.close();
    }
  });

  it("persists a profile across repeated startup", async () => {
    const path = await makePath();
    const profile = baseProfile();
    const first = openStore(path);
    await first.createRuntimeProfile(profile);
    first.close();

    for (let restart = 0; restart < 2; restart += 1) {
      const store = openStore(path);
      expect(await store.getRuntimeProfile("profile-1")).toEqual(profile);
      store.close();
    }

    const last = openStore(path);
    const duplicate = await rejection(last.createRuntimeProfile(profile));
    expect(duplicate).toBeInstanceOf(WorkflowRecordError);
    expect((duplicate as WorkflowRecordError).operation).toBe("create");
    last.close();

    const database = openSqliteDatabase({ path });

    try {
      const version = database.db.prepare("PRAGMA user_version").get();
      expect(Number(version?.user_version)).toBe(2);
    } finally {
      database.close();
    }
  });

  it("lists no profiles when the table is empty", async () => {
    const store = openStore(await makePath());

    expect(await store.listRuntimeProfiles()).toEqual([]);
  });

  it("lists profiles ordered by createdAt and then id", async () => {
    const store = openStore(await makePath());
    const later = baseProfile({
      id: "profile-b",
      createdAt: "2026-10-30T02:00:00.000Z",
      updatedAt: "2026-10-30T02:00:00.000Z",
    });
    const firstByTime = baseProfile({
      id: "profile-z",
      createdAt: "2026-10-30T01:00:00.000Z",
      updatedAt: "2026-10-30T01:00:00.000Z",
    });
    const sameTime = baseProfile({
      id: "profile-a",
      createdAt: "2026-10-30T01:00:00.000Z",
      updatedAt: "2026-10-30T01:00:00.000Z",
    });

    await store.createRuntimeProfile(later);
    await store.createRuntimeProfile(firstByTime);
    await store.createRuntimeProfile(sameTime);

    const listed = await store.listRuntimeProfiles();

    expect(listed.map((profile) => profile.id)).toEqual([
      "profile-a",
      "profile-z",
      "profile-b",
    ]);
  });

  it("round-trips every persisted field through list", async () => {
    const store = openStore(await makePath());
    const profile = baseProfile();
    await store.createRuntimeProfile(profile);

    const listed = await store.listRuntimeProfiles();

    expect(listed).toEqual([profile]);
    expect(listed[0]?.credentialRef).not.toBe(profile.credentialRef);
  });
});
