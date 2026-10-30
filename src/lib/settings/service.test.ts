import { describe, expect, it } from "vitest";
import type { RuntimeProviderCatalog } from "../../types/runtime-catalog";
import type { RuntimeProfilePersistence } from "../../types/persistence";
import type {
  CredentialStatus,
  CredentialStore,
  RuntimeProfile,
} from "../../types/runtime-settings";
import {
  CredentialStoreError,
  InvalidCredentialSecretError,
} from "../runtime/reasonix/env-file-store";
import { WorkflowRecordError } from "../workflow/persistence-errors";
import {
  createSettingsService,
  SettingsError,
  type SettingsServiceDeps,
} from "./service";

const catalog: RuntimeProviderCatalog = {
  source: "reasonix-doctor",
  reasonixVersion: "2.54.0",
  providers: [
    {
      name: "deepseek",
      models: ["deepseek-flash"],
      apiKeyEnv: "DEEPSEEK_API_KEY",
      credentialStatus: "missing",
    },
    {
      name: "openrouter",
      models: ["z-ai/glm-4.6"],
      apiKeyEnv: "OPENROUTER_API_KEY",
      credentialStatus: "unknown",
    },
    {
      name: "local",
      models: ["llama"],
      apiKeyEnv: null,
      credentialStatus: "unknown",
    },
  ],
  configuredDefaultModel: "deepseek/deepseek-flash",
  defaultSelection: { providerName: "deepseek", model: "deepseek-flash" },
};

class MemoryProfileStore implements RuntimeProfilePersistence {
  readonly records = new Map<string, RuntimeProfile>();
  failList = false;
  failGet = false;

  async createRuntimeProfile(profile: RuntimeProfile): Promise<void> {
    if (this.records.has(profile.id)) {
      throw new WorkflowRecordError("create", "runtime profile", profile.id);
    }

    this.records.set(profile.id, profile);
  }

  async getRuntimeProfile(id: string): Promise<RuntimeProfile | null> {
    if (this.failGet) {
      throw new Error("storage exploded");
    }

    return this.records.get(id) ?? null;
  }

  async updateRuntimeProfile(profile: RuntimeProfile): Promise<void> {
    if (!this.records.has(profile.id)) {
      throw new WorkflowRecordError("update", "runtime profile", profile.id);
    }

    this.records.set(profile.id, profile);
  }

  async listRuntimeProfiles(): Promise<readonly RuntimeProfile[]> {
    if (this.failList) {
      throw new Error("storage exploded");
    }

    return [...this.records.values()];
  }
}

class MemoryCredentialStore implements CredentialStore {
  readonly values = new Map<string, string>();
  readonly statusCalls: string[] = [];

  async status(ref: {
    apiKeyEnv: string;
  }): Promise<CredentialStatus> {
    this.statusCalls.push(ref.apiKeyEnv);
    return this.values.has(ref.apiKeyEnv) ? "present" : "missing";
  }

  async set(ref: { apiKeyEnv: string }, secret: string): Promise<void> {
    if (!/^[A-Za-z0-9._~+/=:-]+$/.test(secret)) {
      throw new InvalidCredentialSecretError();
    }

    this.values.set(ref.apiKeyEnv, secret);
  }

  async remove(ref: { apiKeyEnv: string }): Promise<void> {
    this.values.delete(ref.apiKeyEnv);
  }
}

function setup(overrides: Partial<SettingsServiceDeps> = {}) {
  const profiles = new MemoryProfileStore();
  const credentials = new MemoryCredentialStore();
  let nextId = 0;
  const service = createSettingsService({
    profiles,
    credentials,
    loadCatalog: async () => catalog,
    runConnectionTest: async () => ({ outcome: "succeeded" }),
    now: () => "2026-10-30T00:00:00.000Z",
    newId: () => `profile-${(nextId += 1)}`,
    ...overrides,
  });

  return { service, profiles, credentials };
}

async function errorFrom(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("expected the promise to reject");
}

function expectSettingsError(error: unknown, code: string): SettingsError {
  expect(error).toBeInstanceOf(SettingsError);
  const settingsError = error as SettingsError;
  expect(settingsError.code).toBe(code);
  return settingsError;
}

describe("settings service", () => {
  it("creates a profile with catalog-derived non-secret fields", async () => {
    const { service } = setup();

    const profile = await service.createProfile({
      label: "Default",
      providerName: "deepseek",
      model: "deepseek-flash",
    });

    expect(profile).toEqual({
      id: "profile-1",
      label: "Default",
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
    });
  });

  it("rejects client-supplied ids, adapter fields, env names, and secrets", async () => {
    const { service } = setup();

    const error = await errorFrom(
      service.createProfile({
        label: "Default",
        providerName: "deepseek",
        model: "deepseek-flash",
        id: "mine",
        apiKeyEnv: "OTHER",
        secret: "sk-test",
      }),
    );

    const settingsError = expectSettingsError(error, "invalid_request");
    expect(settingsError.fields?.map((field) => field.field)).toEqual([
      "id",
      "apiKeyEnv",
      "secret",
    ]);
  });

  it("rejects an empty label and missing fields", async () => {
    const { service } = setup();

    const error = await errorFrom(service.createProfile({ label: "  " }));

    const settingsError = expectSettingsError(error, "invalid_request");
    expect(settingsError.fields?.map((field) => field.field)).toEqual([
      "label",
      "providerName",
      "model",
    ]);
  });

  it("rejects an unknown provider, an unknown model, and an unknown key env", async () => {
    const { service } = setup();

    expectSettingsError(
      await errorFrom(
        service.createProfile({
          label: "Missing",
          providerName: "missing",
          model: "model",
        }),
      ),
      "provider_unknown",
    );

    expectSettingsError(
      await errorFrom(
        service.createProfile({
          label: "Missing model",
          providerName: "deepseek",
          model: "missing",
        }),
      ),
      "model_unknown",
    );

    expectSettingsError(
      await errorFrom(
        service.createProfile({
          label: "No env",
          providerName: "local",
          model: "llama",
        }),
      ),
      "api_key_env_unknown",
    );
  });

  it("maps catalog failures without exposing upstream detail", async () => {
    const { service } = setup({
      loadCatalog: async () => {
        throw new Error("raw command output with DEEPSEEK_API_KEY=sk-test");
      },
    });

    const error = await errorFrom(
      service.createProfile({
        label: "Default",
        providerName: "deepseek",
        model: "deepseek-flash",
      }),
    );

    const settingsError = expectSettingsError(error, "catalog_unavailable");
    expect(settingsError.message).not.toContain("sk-test");
  });

  it("lists profiles with credential presence and caches by env name", async () => {
    const { service, credentials } = setup();
    await service.createProfile({
      label: "A",
      providerName: "deepseek",
      model: "deepseek-flash",
    });
    await service.createProfile({
      label: "B",
      providerName: "deepseek",
      model: "deepseek-flash",
    });
    credentials.values.set("DEEPSEEK_API_KEY", "sk-test");

    const views = await service.listProfiles();

    expect(views.map((view) => view.credentialStatus)).toEqual([
      "present",
      "present",
    ]);
    expect(credentials.statusCalls).toEqual(["DEEPSEEK_API_KEY"]);
    expect(JSON.stringify(views)).not.toContain("sk-test");
  });

  it("updates a profile, preserving id and createdAt", async () => {
    let timestamp = "2026-10-30T00:00:00.000Z";
    const { service } = setup({ now: () => timestamp });
    const created = await service.createProfile({
      label: "Default",
      providerName: "deepseek",
      model: "deepseek-flash",
    });
    timestamp = "2026-10-30T01:00:00.000Z";

    const updated = await service.updateProfile(created.id, {
      label: "Production",
      providerName: "openrouter",
      model: "z-ai/glm-4.6",
    });

    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).toBe(timestamp);
    expect(updated.apiKeyEnv).toBe("OPENROUTER_API_KEY");
    expect(updated.credentialRef).toEqual({
      kind: "reasonix-env",
      providerName: "openrouter",
      apiKeyEnv: "OPENROUTER_API_KEY",
    });
  });

  it("rejects an update and credential read for an unknown profile", async () => {
    const { service } = setup();

    expectSettingsError(
      await errorFrom(
        service.updateProfile("missing", {
          label: "Missing",
          providerName: "deepseek",
          model: "deepseek-flash",
        }),
      ),
      "profile_not_found",
    );

    expectSettingsError(
      await errorFrom(service.getCredentialStatus("missing")),
      "profile_not_found",
    );
  });

  it("sets and removes a credential, returning presence only", async () => {
    const { service, credentials } = setup();
    const profile = await service.createProfile({
      label: "Default",
      providerName: "deepseek",
      model: "deepseek-flash",
    });

    await expect(
      service.setCredential(profile.id, { secret: "sk-test-very-secret" }),
    ).resolves.toBe("present");
    expect(credentials.values.get("DEEPSEEK_API_KEY")).toBe(
      "sk-test-very-secret",
    );
    expect(JSON.stringify(await service.listProfiles())).not.toContain(
      "sk-test-very-secret",
    );

    await expect(service.removeCredential(profile.id)).resolves.toBe("missing");
    expect(credentials.values.has("DEEPSEEK_API_KEY")).toBe(false);
  });

  it("rejects an invalid secret and extra credential fields", async () => {
    const { service } = setup();
    const profile = await service.createProfile({
      label: "Default",
      providerName: "deepseek",
      model: "deepseek-flash",
    });

    expectSettingsError(
      await errorFrom(service.setCredential(profile.id, { secret: "bad key" })),
      "invalid_secret",
    );

    const extra = await errorFrom(
      service.setCredential(profile.id, {
        secret: "sk-test",
        label: "override",
      }),
    );
    const settingsError = expectSettingsError(extra, "invalid_request");
    expect(settingsError.fields).toEqual([
      { field: "label", message: "is not allowed" },
    ]);
  });

  it.each([
    ["unsafe_path", "credential_path_rejected"],
    ["parse", "credential_file_invalid"],
    ["conflict", "credential_conflict"],
    ["lock", "credential_locked"],
    ["invalid_ref", "credential_unavailable"],
    ["io", "credential_unavailable"],
  ] as const)("maps credential error %s to %s", async (code, expected) => {
    const failing: CredentialStore = {
      status: async () => {
        throw new CredentialStoreError(code, "raw upstream detail");
      },
      set: async () => {
        throw new CredentialStoreError(code, "raw upstream detail");
      },
      remove: async () => {
        throw new CredentialStoreError(code, "raw upstream detail");
      },
    };
    const { service } = setup({ credentials: failing });
    const profile = await service.createProfile({
      label: "Default",
      providerName: "deepseek",
      model: "deepseek-flash",
    });

    const error = await errorFrom(service.getCredentialStatus(profile.id));

    const settingsError = expectSettingsError(error, expected);
    expect(settingsError.message).not.toContain("raw upstream detail");
  });

  it("returns credential_missing without running a test when the key is absent", async () => {
    let calls = 0;
    const { service } = setup({
      runConnectionTest: async () => {
        calls += 1;
        return { outcome: "succeeded" };
      },
    });
    const profile = await service.createProfile({
      label: "Default",
      providerName: "deepseek",
      model: "deepseek-flash",
    });

    await expect(service.testConnection(profile.id)).resolves.toEqual({
      outcome: "failed",
      code: "credential_missing",
    });
    expect(calls).toBe(0);
  });

  it("runs the test for a present or unknown credential", async () => {
    const received: string[] = [];
    const { service, credentials } = setup({
      runConnectionTest: async (profile) => {
        received.push(profile.id);
        return { outcome: "succeeded" };
      },
    });
    const profile = await service.createProfile({
      label: "Default",
      providerName: "deepseek",
      model: "deepseek-flash",
    });

    await service.setCredential(profile.id, { secret: "sk-test-value" });
    await expect(service.testConnection(profile.id)).resolves.toEqual({
      outcome: "succeeded",
    });

    credentials.values.delete("DEEPSEEK_API_KEY");
    const status = await service.getCredentialStatus(profile.id);
    expect(status).toBe("missing");
    received.length = 0;

    const unknownStore: CredentialStore = {
      status: async () => "unknown",
      set: async () => {},
      remove: async () => {},
    };
    const unknownService = setup({
      credentials: unknownStore,
      runConnectionTest: async (candidate) => {
        received.push(candidate.id);
        return { outcome: "succeeded" };
      },
    }).service;
    const unknownProfile = await unknownService.createProfile({
      label: "Default",
      providerName: "deepseek",
      model: "deepseek-flash",
    });

    await expect(
      unknownService.testConnection(unknownProfile.id),
    ).resolves.toEqual({ outcome: "succeeded" });
    expect(received).toEqual([unknownProfile.id]);
  });

  it("rejects an unknown profile before running a test", async () => {
    const { service } = setup();

    expectSettingsError(
      await errorFrom(service.testConnection("missing")),
      "profile_not_found",
    );
  });

  it("maps an unexpected runner failure to runtime_unavailable", async () => {
    const { service } = setup({
      credentials: {
        status: async () => "present",
        set: async () => {},
        remove: async () => {},
      },
      runConnectionTest: async () => {
        throw new Error("raw upstream detail");
      },
    });
    const profile = await service.createProfile({
      label: "Default",
      providerName: "deepseek",
      model: "deepseek-flash",
    });

    const result = await service.testConnection(profile.id);

    expect(result).toEqual({ outcome: "failed", code: "runtime_unavailable" });
    expect(JSON.stringify(result)).not.toContain("raw upstream detail");
  });

  it("maps profile store failures to persistence_error", async () => {
    const { service, profiles } = setup();
    profiles.failList = true;

    expectSettingsError(
      await errorFrom(service.listProfiles()),
      "persistence_error",
    );

    profiles.failGet = true;
    expectSettingsError(
      await errorFrom(service.getCredentialStatus("profile-1")),
      "persistence_error",
    );
  });
});
