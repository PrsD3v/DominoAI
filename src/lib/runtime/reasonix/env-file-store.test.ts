import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import type { CredentialRef } from "../../../types/runtime-settings";
import {
  CredentialFileParseError,
  CredentialFileWriteError,
  CredentialLockError,
  CredentialStoreError,
  CredentialWriteConflictError,
  InvalidCredentialRefError,
  InvalidCredentialSecretError,
  ReasonixEnvFileStore,
  UnsafeCredentialPathError,
  resolveReasonixEnvFile,
  type ReasonixEnvFileStoreOptions,
} from "./env-file-store";

const homes: string[] = [];

async function makeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "domino-env-store-"));
  homes.push(home);
  return home;
}

afterEach(async () => {
  await Promise.all(
    homes.splice(0).map((home) => rm(home, { recursive: true, force: true })),
  );
});

function envPath(home: string): string {
  return join(home, ".env");
}

function lockPath(home: string): string {
  return join(home, ".env.lock");
}

function ref(apiKeyEnv = "TEST_KEY", providerName = "test-provider"): CredentialRef {
  return {
    kind: "reasonix-env",
    providerName,
    apiKeyEnv,
  };
}

function createStore(
  home: string,
  options: Partial<ReasonixEnvFileStoreOptions> = {},
): ReasonixEnvFileStore {
  return new ReasonixEnvFileStore({
    homeDir: home,
    retryDelayMs: 5,
    ...options,
  });
}

async function readEnv(home: string): Promise<string> {
  return readFile(envPath(home), "utf8");
}

async function writeEnv(home: string, content: string): Promise<void> {
  await writeFile(envPath(home), content, "utf8");
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function artifacts(home: string): Promise<string[]> {
  const entries = await readdir(home);
  return entries.filter(
    (name) =>
      name === ".env.lock" ||
      name === ".env.lock.recover" ||
      name.startsWith(".env.tmp."),
  );
}

function deadProcessPid(): number {
  const dead = spawnSync(process.execPath, ["-e", ""], { stdio: "ignore" });

  if (typeof dead.pid !== "number") {
    throw new Error("Could not create a dead process PID for the lock test.");
  }

  return dead.pid;
}

async function fileMode(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777;
}

const posixOnly = process.platform === "win32";
// Windows has no POSIX mode bits, and symlink creation may require privileges.
// Those paths are not claimed as supported in this stage.
const canTestPermissions =
  process.platform !== "win32" &&
  (typeof process.getuid !== "function" || process.getuid() !== 0);

describe("resolveReasonixEnvFile", () => {
  it("resolves .env under the supplied home", () => {
    expect(resolveReasonixEnvFile("/tmp/example-home")).toBe(
      "/tmp/example-home/.env",
    );
  });

  it("rejects an empty home", () => {
    expect(() => resolveReasonixEnvFile("")).toThrow(TypeError);
  });
});

describe("ReasonixEnvFileStore status", () => {
  it("returns missing when the file does not exist", async () => {
    const home = await makeHome();
    const store = createStore(home);

    await expect(store.status(ref())).resolves.toBe("missing");
  });

  it("returns present for a non-empty value and missing for an empty one", async () => {
    const home = await makeHome();
    const store = createStore(home);

    await writeEnv(home, 'TEST_KEY=""\n');
    await expect(store.status(ref())).resolves.toBe("missing");

    await writeEnv(home, 'TEST_KEY="value"\n');
    await expect(store.status(ref())).resolves.toBe("present");
  });

  it("returns missing when the home is absent", async () => {
    const home = join(
      tmpdir(),
      `domino-env-store-missing-${process.pid}-${Date.now()}`,
    );
    const store = createStore(home);

    await expect(store.status(ref())).resolves.toBe("missing");
    await expect(store.set(ref(), "value")).rejects.toBeInstanceOf(
      UnsafeCredentialPathError,
    );
    await expect(exists(join(home, ".env"))).resolves.toBe(false);
  });
});

describe("ReasonixEnvFileStore set", () => {
  it("creates a new file with 0600 permissions", async () => {
    const home = await makeHome();
    const store = createStore(home);

    await store.set(ref(), "sk-test-alpha");

    await expect(readEnv(home)).resolves.toBe("TEST_KEY=sk-test-alpha\n");
    await expect(store.status(ref())).resolves.toBe("present");
    await expect(artifacts(home)).resolves.toEqual([]);

    if (!posixOnly) {
      await expect(fileMode(envPath(home))).resolves.toBe(0o600);
    }
  });

  it("updates an existing key without duplicating it", async () => {
    const home = await makeHome();
    const store = createStore(home);

    await store.set(ref(), "first-value");
    await store.set(ref(), "second-value");

    const content = await readEnv(home);
    expect(content).toBe("TEST_KEY=second-value\n");
    expect(content).not.toContain("first-value");
  });

  it("preserves comments, blank lines, and unrelated keys", async () => {
    const home = await makeHome();
    const store = createStore(home);
    const original = [
      "# top comment",
      "",
      "OTHER_KEY=other",
      'QUOTED="quoted"',
      "SPACED = spaced",
      "export EXPORTED=exported",
    ].join("\r\n");

    await writeEnv(home, `${original}\r\n`);
    await store.set(ref("NEW_KEY"), "new-value");

    const content = await readEnv(home);
    expect(content).toContain("# top comment\r\n");
    expect(content).toContain("\r\n\r\n");
    expect(content).toContain("OTHER_KEY=other\r\n");
    expect(content).toContain('QUOTED="quoted"\r\n');
    expect(content).toContain("SPACED = spaced\r\n");
    expect(content).toContain("export EXPORTED=exported\r\n");
    expect(content).toContain("NEW_KEY=new-value\r\n");
  });

  it("reads supported quoting, export, whitespace, and CRLF formats", async () => {
    const home = await makeHome();
    const store = createStore(home);
    const content = [
      'QUOTED="quoted"',
      "SPACED = spaced",
      "export EXPORTED=exported",
      "CRLF_KEY=crlf",
    ].join("\r\n");

    await writeEnv(home, `${content}\r\n`);

    for (const key of ["QUOTED", "SPACED", "EXPORTED", "CRLF_KEY"]) {
      await expect(store.status(ref(key))).resolves.toBe("present");
    }
  });

  it("preserves export and line endings when replacing a key", async () => {
    const home = await makeHome();
    const store = createStore(home);

    await writeEnv(home, "export TEST_KEY=old\r\nOTHER=one\r\n");
    await store.set(ref(), "new");

    await expect(readEnv(home)).resolves.toBe(
      "export TEST_KEY=new\r\nOTHER=one\r\n",
    );
  });

  it("rejects malformed files without changing them", async () => {
    const home = await makeHome();
    const store = createStore(home);
    const original = "BROKEN LINE\nTEST_KEY=original\n";

    await writeEnv(home, original);

    await expect(store.set(ref(), "new")).rejects.toBeInstanceOf(
      CredentialFileParseError,
    );
    await expect(store.status(ref())).rejects.toBeInstanceOf(
      CredentialFileParseError,
    );
    await expect(readEnv(home)).resolves.toBe(original);
    await expect(artifacts(home)).resolves.toEqual([]);
  });

  it("rejects duplicate keys without changing the file", async () => {
    const home = await makeHome();
    const store = createStore(home);
    const original = "TEST_KEY=one\nTEST_KEY=two\n";

    await writeEnv(home, original);

    await expect(store.set(ref(), "new")).rejects.toBeInstanceOf(
      CredentialFileParseError,
    );
    await expect(readEnv(home)).resolves.toBe(original);
  });

  it("rejects invalid references before touching the filesystem", async () => {
    const home = await makeHome();
    const store = createStore(home);

    await expect(store.set(ref("BAD NAME"), "value")).rejects.toBeInstanceOf(
      InvalidCredentialRefError,
    );
    await expect(exists(envPath(home))).resolves.toBe(false);
    await expect(exists(lockPath(home))).resolves.toBe(false);
  });

  it("rejects invalid secrets before touching the filesystem", async () => {
    const home = await makeHome();
    const store = createStore(home);

    for (const secret of [
      "",
      "has space",
      "line\nbreak",
      'quote"',
      "hash#value",
    ]) {
      await expect(store.set(ref(), secret)).rejects.toBeInstanceOf(
        InvalidCredentialSecretError,
      );
    }

    await expect(exists(envPath(home))).resolves.toBe(false);
    await expect(exists(lockPath(home))).resolves.toBe(false);
  });

  it.skipIf(posixOnly)("rejects a symlinked .env", async () => {
    const home = await makeHome();
    const store = createStore(home);
    const target = join(home, "target.env");

    await writeFile(target, "OTHER=value\n", "utf8");
    await symlink(target, envPath(home));

    await expect(store.status(ref())).rejects.toBeInstanceOf(
      UnsafeCredentialPathError,
    );
    await expect(store.set(ref(), "value")).rejects.toBeInstanceOf(
      UnsafeCredentialPathError,
    );
    await expect(readFile(target, "utf8")).resolves.toBe("OTHER=value\n");
    await expect(artifacts(home)).resolves.toEqual([]);
  });

  it("rejects a directory at the .env path", async () => {
    const home = await makeHome();
    const store = createStore(home);

    await mkdir(envPath(home));

    await expect(store.status(ref())).rejects.toBeInstanceOf(
      UnsafeCredentialPathError,
    );
    await expect(store.set(ref(), "value")).rejects.toBeInstanceOf(
      UnsafeCredentialPathError,
    );
    await expect(exists(lockPath(home))).resolves.toBe(false);
  });

  it.skipIf(posixOnly)("sets 0600 on an existing file", async () => {
    const home = await makeHome();
    const store = createStore(home);

    await writeEnv(home, "TEST_KEY=old\n");
    await chmod(envPath(home), 0o644);
    await store.set(ref(), "new");

    await expect(fileMode(envPath(home))).resolves.toBe(0o600);
  });
});

describe("ReasonixEnvFileStore remove", () => {
  it("removes a key and preserves unrelated content", async () => {
    const home = await makeHome();
    const store = createStore(home);

    await writeEnv(home, "# comment\nOTHER_KEY=other\n\nTEST_KEY=secret\n");
    await store.remove(ref());

    const content = await readEnv(home);
    expect(content).toContain("# comment");
    expect(content).toContain("OTHER_KEY=other");
    expect(content).not.toContain("TEST_KEY");
    await expect(store.status(ref())).resolves.toBe("missing");
    await expect(artifacts(home)).resolves.toEqual([]);
  });

  it("rejects malformed files on remove", async () => {
    const home = await makeHome();
    const store = createStore(home);
    const original = "BROKEN LINE\nTEST_KEY=value\n";

    await writeEnv(home, original);

    await expect(store.remove(ref())).rejects.toBeInstanceOf(
      CredentialFileParseError,
    );
    await expect(readEnv(home)).resolves.toBe(original);
    await expect(artifacts(home)).resolves.toEqual([]);
  });

  it("is a no-op when the file or key is missing", async () => {
    const home = await makeHome();
    const store = createStore(home);

    await expect(store.remove(ref())).resolves.toBeUndefined();
    await expect(exists(envPath(home))).resolves.toBe(false);

    const original = "# comment\nOTHER_KEY=other\n";
    await writeEnv(home, original);
    await store.remove(ref());

    await expect(readEnv(home)).resolves.toBe(original);
    await expect(artifacts(home)).resolves.toEqual([]);
  });
});

describe("ReasonixEnvFileStore concurrency and failures", () => {
  it("serializes separate store instances without losing updates", async () => {
    const home = await makeHome();
    const first = createStore(home);
    const second = createStore(home);

    await Promise.all([
      first.set(ref("FIRST_KEY"), "first-value"),
      second.set(ref("SECOND_KEY"), "second-value"),
    ]);

    const content = await readEnv(home);
    expect(content).toContain("FIRST_KEY=first-value");
    expect(content).toContain("SECOND_KEY=second-value");
    await expect(first.status(ref("FIRST_KEY"))).resolves.toBe("present");
    await expect(second.status(ref("SECOND_KEY"))).resolves.toBe("present");
    await expect(artifacts(home)).resolves.toEqual([]);
  });

  it("preserves the original when the atomic commit fails", async () => {
    const home = await makeHome();
    const store = createStore(home, {
      beforeCommit: () => {
        throw new Error("simulated commit failure");
      },
    });
    const original = "TEST_KEY=original\n";

    await writeEnv(home, original);

    await expect(store.set(ref(), "new")).rejects.toBeInstanceOf(
      CredentialFileWriteError,
    );
    await expect(readEnv(home)).resolves.toBe(original);
    await expect(artifacts(home)).resolves.toEqual([]);
  });

  it("detects an external modification and does not overwrite it", async () => {
    const home = await makeHome();
    const store = createStore(home, {
      beforeCommit: async () => {
        await writeFile(envPath(home), "TEST_KEY=external\n", "utf8");
      },
    });

    await writeEnv(home, "TEST_KEY=original\n");

    await expect(store.set(ref(), "new")).rejects.toBeInstanceOf(
      CredentialWriteConflictError,
    );
    await expect(readEnv(home)).resolves.toBe("TEST_KEY=external\n");
    await expect(artifacts(home)).resolves.toEqual([]);
  });

  it("times out on a fresh foreign lock and leaves it alone", async () => {
    const home = await makeHome();
    const store = createStore(home, {
      lockTimeoutMs: 40,
      staleLockMs: 60_000,
      retryDelayMs: 5,
    });
    const original = "TEST_KEY=original\n";

    await writeEnv(home, original);
    await writeFile(
      lockPath(home),
      `foreign-token ${process.pid}\n`,
      "utf8",
    );

    await expect(store.set(ref(), "new")).rejects.toBeInstanceOf(
      CredentialLockError,
    );
    await expect(readEnv(home)).resolves.toBe(original);
    await expect(exists(lockPath(home))).resolves.toBe(true);
  });

  it("does not steal a malformed lock", async () => {
    const home = await makeHome();
    const store = createStore(home, {
      lockTimeoutMs: 40,
      staleLockMs: 10,
      retryDelayMs: 5,
    });
    const original = "TEST_KEY=original\n";

    await writeEnv(home, original);
    await writeFile(lockPath(home), "malformed\n", "utf8");
    const old = new Date(Date.now() - 5_000);
    await utimes(lockPath(home), old, old);

    await expect(store.set(ref(), "new")).rejects.toBeInstanceOf(
      CredentialLockError,
    );
    await expect(readEnv(home)).resolves.toBe(original);
    await expect(exists(lockPath(home))).resolves.toBe(true);
  });

  it("breaks a stale lock left by a dead process", async () => {
    const home = await makeHome();
    const store = createStore(home, {
      lockTimeoutMs: 500,
      staleLockMs: 10,
      retryDelayMs: 5,
    });
    const dead = spawnSync(process.execPath, ["-e", ""], { stdio: "ignore" });
    const deadPid = dead.pid;

    expect(typeof deadPid).toBe("number");

    await writeEnv(home, "TEST_KEY=original\n");
    await writeFile(lockPath(home), `stale-token ${deadPid}\n`, "utf8");
    const old = new Date(Date.now() - 5_000);
    await utimes(lockPath(home), old, old);

    await store.set(ref(), "new");

    await expect(readEnv(home)).resolves.toBe("TEST_KEY=new\n");
    await expect(artifacts(home)).resolves.toEqual([]);
  });

  it.skipIf(posixOnly)("creates temporary files with 0600", async () => {
    const home = await makeHome();
    let temporaryMode: number | undefined;
    const store = createStore(home, {
      beforeCommit: async () => {
        const names = await readdir(home);
        const temporary = names.find((name) => name.startsWith(".env.tmp."));

        expect(temporary).toBeDefined();
        if (!temporary) {
          return;
        }

        temporaryMode = (await stat(join(home, temporary))).mode & 0o777;
      },
    });

    await store.set(ref(), "value");

    expect(temporaryMode).toBe(0o600);
  });

  it("cleans a stale temporary file left by a crashed writer", async () => {
    const home = await makeHome();
    const store = createStore(home, { staleLockMs: 10 });
    const stale = join(
      home,
      `.env.tmp.${deadProcessPid()}.00000000-0000-4000-8000-000000000000`,
    );

    await writeFile(stale, "dummy\n", "utf8");
    const old = new Date(Date.now() - 5_000);
    await utimes(stale, old, old);

    await store.set(ref(), "value");

    await expect(exists(stale)).resolves.toBe(false);
    await expect(readEnv(home)).resolves.toBe("TEST_KEY=value\n");
  });

  it("does not delete a temporary file owned by a live process", async () => {
    const home = await makeHome();
    const store = createStore(home, { staleLockMs: 10 });
    const active = join(
      home,
      `.env.tmp.${process.pid}.00000000-0000-4000-8000-000000000001`,
    );

    await writeFile(active, "dummy\n", "utf8");
    const old = new Date(Date.now() - 5_000);
    await utimes(active, old, old);

    await store.set(ref(), "value");

    await expect(exists(active)).resolves.toBe(true);
    await expect(readEnv(home)).resolves.toBe("TEST_KEY=value\n");
  });

  it.skipIf(!canTestPermissions)(
    "fails safely when the home directory is not writable",
    async () => {
      const home = await makeHome();
      const store = createStore(home);
      const original = "TEST_KEY=original\n";

      await writeEnv(home, original);
      await chmod(home, 0o500);

      try {
        await expect(store.set(ref(), "new")).rejects.toBeInstanceOf(
          CredentialStoreError,
        );
        await expect(readEnv(home)).resolves.toBe(original);
      } finally {
        await chmod(home, 0o700);
      }
    },
  );

  it.skipIf(posixOnly)("rejects a symlinked lock path", async () => {
    const home = await makeHome();
    const store = createStore(home);
    const target = join(home, "lock-target");

    await writeFile(target, "foreign\n", "utf8");
    await symlink(target, lockPath(home));

    await expect(store.set(ref(), "value")).rejects.toBeInstanceOf(
      UnsafeCredentialPathError,
    );
    await expect(readFile(target, "utf8")).resolves.toBe("foreign\n");
    await expect(exists(envPath(home))).resolves.toBe(false);
  });

  it("does not expose a hook error containing a secret", async () => {
    const home = await makeHome();
    const hookSecret = "sk-hook-error-secret";
    const store = createStore(home, {
      beforeCommit: () => {
        throw new Error(hookSecret);
      },
    });

    const error = await store
      .set(ref(), "value")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CredentialFileWriteError);
    expect(String(error)).not.toContain(hookSecret);
  });

  it("does not expose secret values in errors", async () => {
    const home = await makeHome();
    const store = createStore(home);
    const secret = "sk-super-secret-value-do-not-print";

    await writeEnv(home, "BROKEN LINE\n");

    const parseError = await store
      .set(ref(), secret)
      .catch((error: unknown) => error);

    expect(parseError).toBeInstanceOf(CredentialFileParseError);
    expect(String(parseError)).not.toContain(secret);
    expect(String((parseError as Error).stack)).not.toContain(secret);

    const invalidSecret = "secret with spaces";
    const secretError = await store
      .set(ref(), invalidSecret)
      .catch((error: unknown) => error);

    expect(secretError).toBeInstanceOf(InvalidCredentialSecretError);
    expect(String(secretError)).not.toContain(invalidSecret);
  });
});

describe("ReasonixEnvFileStore hardening", () => {
  it("serializes simultaneous stale-lock takeover", async () => {
    const home = await makeHome();
    const stalePid = deadProcessPid();

    await writeFile(lockPath(home), `stale-token ${stalePid}\n`, "utf8");
    const old = new Date(Date.now() - 5_000);
    await utimes(lockPath(home), old, old);

    let enterRecovery: () => void = () => {};
    const entered = new Promise<void>((resolve) => {
      enterRecovery = resolve;
    });
    let releaseRecovery: () => void = () => {};
    const release = new Promise<void>((resolve) => {
      releaseRecovery = resolve;
    });

    let active = 0;
    let maxActive = 0;
    const beforeCommit = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      active -= 1;
    };

    const first = createStore(home, {
      staleLockMs: 10,
      lockTimeoutMs: 500,
      retryDelayMs: 5,
      beforeStaleRecovery: async () => {
        enterRecovery();
        await release;
      },
      beforeCommit,
    });
    const second = createStore(home, {
      staleLockMs: 10,
      lockTimeoutMs: 500,
      retryDelayMs: 5,
      beforeCommit,
    });

    const firstWrite = first.set(ref("FIRST_KEY"), "first");
    await entered;
    const secondWrite = second.set(ref("SECOND_KEY"), "second");

    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      expect(maxActive).toBe(0);
    } finally {
      releaseRecovery();
    }

    await Promise.all([firstWrite, secondWrite]);

    expect(maxActive).toBe(1);

    const content = await readEnv(home);
    expect(content).toContain("FIRST_KEY=first");
    expect(content).toContain("SECOND_KEY=second");
    await expect(artifacts(home)).resolves.toEqual([]);
  });

  it("times out on a stale recovery marker without stealing it", async () => {
    const home = await makeHome();
    const recovery = join(home, ".env.lock.recover");

    await writeFile(lockPath(home), `stale-token ${deadProcessPid()}\n`, "utf8");
    await writeFile(recovery, `recovery-token ${process.pid}\n`, "utf8");
    const old = new Date(Date.now() - 5_000);
    await utimes(lockPath(home), old, old);
    await utimes(recovery, old, old);

    const store = createStore(home, {
      lockTimeoutMs: 40,
      staleLockMs: 10,
      retryDelayMs: 5,
    });

    await expect(store.set(ref(), "value")).rejects.toBeInstanceOf(
      CredentialLockError,
    );
    await expect(exists(recovery)).resolves.toBe(true);
    await expect(exists(envPath(home))).resolves.toBe(false);
  });

  it("rejects a directory at the lock path", async () => {
    const home = await makeHome();
    const store = createStore(home);

    await mkdir(lockPath(home));

    await expect(store.set(ref(), "value")).rejects.toBeInstanceOf(
      UnsafeCredentialPathError,
    );
    await expect(exists(envPath(home))).resolves.toBe(false);
    await expect(exists(join(home, ".env.lock.recover"))).resolves.toBe(
      false,
    );
  });

  it("rejects a directory at the recovery marker path", async () => {
    const home = await makeHome();
    const store = createStore(home);

    await mkdir(join(home, ".env.lock.recover"));

    await expect(store.set(ref(), "value")).rejects.toBeInstanceOf(
      UnsafeCredentialPathError,
    );
    await expect(exists(envPath(home))).resolves.toBe(false);
  });

  it.skipIf(posixOnly)("rejects a statically symlinked home", async () => {
    const home = await makeHome();
    const link = join(home, "home-link");

    await symlink(home, link);
    const store = createStore(link);

    await expect(store.status(ref())).rejects.toBeInstanceOf(
      UnsafeCredentialPathError,
    );
    await expect(store.set(ref(), "value")).rejects.toBeInstanceOf(
      UnsafeCredentialPathError,
    );
    await expect(exists(envPath(home))).resolves.toBe(false);
  });

  it.skipIf(posixOnly)(
    "rejects a home replacement during commit",
    async () => {
      const home = await makeHome();
      const moved = `${home}-moved`;
      const attacker = await makeHome();
      homes.push(moved);

      const original = "TEST_KEY=original\n";
      await writeEnv(home, original);

      const store = createStore(home, {
        beforeCommit: async () => {
          await rename(home, moved);
          await symlink(attacker, home);
        },
      });

      await expect(store.set(ref(), "new")).rejects.toBeInstanceOf(
        UnsafeCredentialPathError,
      );
      await expect(readFile(join(moved, ".env"), "utf8")).resolves.toBe(
        original,
      );
      await expect(exists(join(attacker, ".env"))).resolves.toBe(false);
    },
  );

  it.skipIf(!canTestPermissions)(
    "reports a real rename failure without changing the original",
    async () => {
      const home = await makeHome();
      const original = "TEST_KEY=original\n";
      const secret = "sk-rename-failure-secret";
      await writeEnv(home, original);

      const store = createStore(home, {
        beforeCommit: async () => {
          await chmod(home, 0o500);
        },
      });

      let error: unknown;

      try {
        error = await store.set(ref(), secret).catch((caught: unknown) => caught);
      } finally {
        await chmod(home, 0o700);
      }

      expect(error).toBeInstanceOf(CredentialFileWriteError);
      expect(String(error)).not.toContain(secret);
      await expect(readEnv(home)).resolves.toBe(original);
      await expect(exists(lockPath(home))).resolves.toBe(true);
    },
  );

  it("accepts and preserves a quoted inline comment", async () => {
    const home = await makeHome();
    const store = createStore(home);

    await writeEnv(home, 'TEST_KEY="old" # keep\nOTHER_KEY=one\n');

    await expect(store.status(ref())).resolves.toBe("present");
    await store.set(ref(), "new");

    await expect(readEnv(home)).resolves.toBe(
      "TEST_KEY=new # keep\nOTHER_KEY=one\n",
    );
  });

  it("rejects an unbalanced escaped quote", async () => {
    const home = await makeHome();
    const store = createStore(home);
    const original = 'TEST_KEY="a\\"\nOTHER=one\n';

    await writeEnv(home, original);

    await expect(store.set(ref(), "new")).rejects.toBeInstanceOf(
      CredentialFileParseError,
    );
    await expect(readEnv(home)).resolves.toBe(original);
  });

  it("accepts a balanced escaped quote", async () => {
    const home = await makeHome();
    const store = createStore(home);

    await writeEnv(home, 'OTHER_KEY="a\\"b"\nTEST_KEY=value\n');

    await expect(store.status(ref("OTHER_KEY"))).resolves.toBe("present");
    await store.set(ref(), "new");

    await expect(readEnv(home)).resolves.toBe(
      'OTHER_KEY="a\\"b"\nTEST_KEY=new\n',
    );
  });

  it("rejects trailing text after a quoted value", async () => {
    const home = await makeHome();
    const store = createStore(home);
    const original = 'TEST_KEY="value" trailing\n';

    await writeEnv(home, original);

    await expect(store.set(ref(), "new")).rejects.toBeInstanceOf(
      CredentialFileParseError,
    );
    await expect(readEnv(home)).resolves.toBe(original);
  });

  it("accepts BOM, single quotes, leading whitespace, and CRLF", async () => {
    const home = await makeHome();
    const store = createStore(home);
    const original =
      "\uFEFF  OTHER_KEY='value'\r\nTEST_KEY=\"quoted\"\r\n";

    await writeEnv(home, original);

    await expect(store.status(ref("OTHER_KEY"))).resolves.toBe("present");
    await expect(store.status(ref("TEST_KEY"))).resolves.toBe("present");

    await store.set(ref("NEW_KEY"), "new");

    const content = await readEnv(home);
    expect(content.startsWith("\uFEFF")).toBe(true);
    expect(content).toContain("  OTHER_KEY='value'\r\n");
    expect(content).toContain('TEST_KEY="quoted"\r\n');
    expect(content).toContain("NEW_KEY=new\r\n");
  });
});

describe("ReasonixEnvFileStore interface", () => {
  it("has no readback method", () => {
    expectTypeOf<keyof ReasonixEnvFileStore>().toEqualTypeOf<
      "status" | "set" | "remove"
    >();
    expectTypeOf<
      "get" extends keyof ReasonixEnvFileStore ? true : false
    >().toEqualTypeOf<false>();
  });
});
