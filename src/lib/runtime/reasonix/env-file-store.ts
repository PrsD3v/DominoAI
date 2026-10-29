import { randomUUID, createHash } from "node:crypto";
import { constants } from "node:fs";
import type { Stats } from "node:fs";
import { lstat, open, readdir, rename, stat, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  validateCredentialRef,
  type CredentialRef,
  type CredentialStatus,
  type CredentialStore,
  type RuntimeSettingsValidationError,
} from "../../../types/runtime-settings";

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const READ_FLAGS = constants.O_RDONLY | NOFOLLOW;
const WRITE_FLAGS =
  constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW;
const LOCK_FLAGS = WRITE_FLAGS;
const DIRECTORY_FLAGS = constants.O_RDONLY | (constants.O_DIRECTORY ?? 0);

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SECRET_PATTERN = /^[A-Za-z0-9._~+/=:-]+$/;
const TEMP_NAME_PATTERN = /^\.env\.tmp\.(\d+)\.([0-9a-f-]+)$/;

export type CredentialStoreErrorCode =
  | "invalid_ref"
  | "invalid_secret"
  | "parse"
  | "unsafe_path"
  | "conflict"
  | "lock"
  | "io";

export class CredentialStoreError extends Error {
  readonly code: CredentialStoreErrorCode;

  constructor(code: CredentialStoreErrorCode, message: string) {
    super(message);
    this.name = "CredentialStoreError";
    this.code = code;
  }
}

export class InvalidCredentialRefError extends CredentialStoreError {
  readonly errors: RuntimeSettingsValidationError[];

  constructor(errors: RuntimeSettingsValidationError[]) {
    super("invalid_ref", "Credential reference is invalid.");
    this.name = "InvalidCredentialRefError";
    this.errors = errors;
  }
}

export class InvalidCredentialSecretError extends CredentialStoreError {
  constructor() {
    super(
      "invalid_secret",
      "Credential secret must be a non-empty token with no whitespace, quotes, or control characters.",
    );
    this.name = "InvalidCredentialSecretError";
  }
}

export class CredentialFileParseError extends CredentialStoreError {
  readonly line: number;

  constructor(line: number, reason = "malformed line") {
    super("parse", `Credential file is invalid at line ${line}: ${reason}.`);
    this.name = "CredentialFileParseError";
    this.line = line;
  }
}

export class UnsafeCredentialPathError extends CredentialStoreError {
  constructor(message = "Credential path is not a safe regular file.") {
    super("unsafe_path", message);
    this.name = "UnsafeCredentialPathError";
  }
}

export class CredentialWriteConflictError extends CredentialStoreError {
  constructor() {
    super(
      "conflict",
      "Credential file changed while the write was in progress.",
    );
    this.name = "CredentialWriteConflictError";
  }
}

export class CredentialLockError extends CredentialStoreError {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super("lock", `Could not acquire the credential lock within ${timeoutMs} ms.`);
    this.name = "CredentialLockError";
    this.timeoutMs = timeoutMs;
  }
}

export class CredentialFileReadError extends CredentialStoreError {
  constructor() {
    super("io", "Could not read the credential file.");
    this.name = "CredentialFileReadError";
  }
}

export class CredentialFileWriteError extends CredentialStoreError {
  constructor() {
    super("io", "Could not write the credential file.");
    this.name = "CredentialFileWriteError";
  }
}

export interface ReasonixEnvFileStoreOptions {
  /** Resolved Reasonix home directory that contains config.toml and .env. */
  readonly homeDir: string;
  readonly lockTimeoutMs?: number;
  readonly staleLockMs?: number;
  readonly retryDelayMs?: number;
  /** Test seam: runs after the temp file is written and before the commit check. */
  readonly beforeCommit?: () => Promise<void> | void;
  /** Test seam: runs after the recovery marker is claimed. */
  readonly beforeStaleRecovery?: () => Promise<void> | void;
}

interface EnvLine {
  kind: "blank" | "comment" | "entry";
  text: string;
  newline: string;
  prefix: string;
  key?: string;
  value?: string;
  commentSuffix?: string;
}

interface ParsedEnvFile {
  lines: EnvLine[];
  entries: Map<string, EnvLine>;
  hasBom: boolean;
  newline: string;
}

interface Snapshot {
  content: string;
  hash: string;
}

interface HomeIdentity {
  dev: number;
  ino: number;
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function errorCode(error: unknown): string | undefined {
  return isErrno(error) ? error.code : undefined;
}

function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function positive(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive number`);
  }

  return value;
}

function splitLines(content: string): Array<{ text: string; newline: string }> {
  const lines: Array<{ text: string; newline: string }> = [];
  let start = 0;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

    if (character !== "\n" && character !== "\r") {
      continue;
    }

    let newline = character;

    if (character === "\r" && content[index + 1] === "\n") {
      newline = "\r\n";
      index += 1;
    }

    lines.push({ text: content.slice(start, index - newline.length + 1), newline });
    start = index + 1;
  }

  if (start < content.length) {
    lines.push({ text: content.slice(start), newline: "" });
  }

  return lines;
}

function parseValue(
  raw: string,
  line: number,
): { value: string; commentSuffix: string } {
  const valueText = raw.replace(/^\s+/, "");

  if (valueText === "") {
    return { value: "", commentSuffix: "" };
  }

  const quote = valueText[0];

  if (quote === '"' || quote === "'") {
    let index = 1;
    let escaped = false;
    let contentEnd = -1;

    for (; index < valueText.length; index += 1) {
      const character = valueText[index];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === "\\") {
        escaped = true;
        continue;
      }

      if (character === quote) {
        contentEnd = index;
        break;
      }
    }

    if (contentEnd < 0) {
      throw new CredentialFileParseError(line, "unbalanced quote");
    }

    const rest = valueText.slice(contentEnd + 1);
    const trimmedRest = rest.trim();

    if (trimmedRest !== "" && !trimmedRest.startsWith("#")) {
      throw new CredentialFileParseError(
        line,
        "unexpected text after quoted value",
      );
    }

    return {
      value: valueText.slice(1, contentEnd),
      commentSuffix: trimmedRest === "" ? "" : rest,
    };
  }

  const value = valueText.trim();

  if (value.endsWith('"') || value.endsWith("'")) {
    throw new CredentialFileParseError(line, "unbalanced quote");
  }

  return { value, commentSuffix: "" };
}

function parseEnvFile(content: string): ParsedEnvFile {
  const hasBom = content.startsWith("\uFEFF");
  const body = hasBom ? content.slice(1) : content;
  const lines: EnvLine[] = [];
  const entries = new Map<string, EnvLine>();

  for (const [index, rawLine] of splitLines(body).entries()) {
    const lineNumber = index + 1;

    if (rawLine.text.includes("\u0000")) {
      throw new CredentialFileParseError(lineNumber, "NUL byte");
    }

    const trimmed = rawLine.text.trim();

    if (trimmed === "") {
      lines.push({ ...rawLine, kind: "blank", prefix: "" });
      continue;
    }

    if (trimmed.startsWith("#")) {
      lines.push({ ...rawLine, kind: "comment", prefix: "" });
      continue;
    }

    const match = rawLine.text.match(/^(\s*)(export\s+)?(.*)$/);

    if (!match) {
      throw new CredentialFileParseError(lineNumber);
    }

    const prefix = `${match[1]}${match[2] ?? ""}`;
    const assignment = match[3];
    const equals = assignment.indexOf("=");

    if (equals < 0) {
      throw new CredentialFileParseError(lineNumber, "missing equals sign");
    }

    const key = assignment.slice(0, equals).trim();

    if (!ENV_NAME_PATTERN.test(key)) {
      throw new CredentialFileParseError(lineNumber, "invalid variable name");
    }

    if (entries.has(key)) {
      throw new CredentialFileParseError(lineNumber, `duplicate key ${key}`);
    }

    const value = parseValue(assignment.slice(equals + 1), lineNumber);
    const line: EnvLine = {
      ...rawLine,
      kind: "entry",
      prefix,
      key,
      value: value.value,
      commentSuffix: value.commentSuffix,
    };

    entries.set(key, line);
    lines.push(line);
  }

  return {
    lines,
    entries,
    hasBom,
    newline: body.includes("\r\n") ? "\r\n" : "\n",
  };
}

function serializeEnvFile(parsed: ParsedEnvFile, lines: EnvLine[]): string {
  const body = lines.map((line) => `${line.text}${line.newline}`).join("");
  return `${parsed.hasBom ? "\uFEFF" : ""}${body}`;
}

function applySet(parsed: ParsedEnvFile, key: string, value: string): string {
  const lines = parsed.lines.map((line) => ({ ...line }));
  const index = lines.findIndex(
    (line) => line.kind === "entry" && line.key === key,
  );

  if (index >= 0) {
    lines[index] = {
      ...lines[index],
      text: `${lines[index].prefix}${key}=${value}${lines[index].commentSuffix ?? ""}`,
      value,
    };
  } else {
    if (lines.length > 0 && lines[lines.length - 1].newline === "") {
      lines[lines.length - 1] = {
        ...lines[lines.length - 1],
        newline: parsed.newline,
      };
    }

    lines.push({
      kind: "entry",
      text: `${key}=${value}`,
      newline: parsed.newline,
      prefix: "",
      key,
      value,
    });
  }

  return serializeEnvFile(parsed, lines);
}

function applyRemove(parsed: ParsedEnvFile, key: string): string {
  const lines = parsed.lines
    .filter((line) => !(line.kind === "entry" && line.key === key))
    .map((line) => ({ ...line }));

  return serializeEnvFile(parsed, lines);
}

function sameSnapshot(before: Snapshot | null, after: Snapshot | null): boolean {
  if (before === null) {
    return after === null;
  }

  return after !== null && after.hash === before.hash;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function processIsAlive(pid: number): boolean {
  if (pid === process.pid) {
    return true;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

async function readSmallText(path: string): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    handle = await open(path, READ_FLAGS);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return null;
    }

    if (errorCode(error) === "ELOOP") {
      throw new UnsafeCredentialPathError();
    }

    throw new CredentialFileReadError();
  }

  try {
    return await handle.readFile({ encoding: "utf8" });
  } catch {
    throw new CredentialFileReadError();
  } finally {
    await handle.close().catch(() => {});
  }
}

async function syncDirectory(path: string): Promise<void> {
  if (process.platform === "win32") {
    return;
  }

  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    handle = await open(path, DIRECTORY_FLAGS);
    await handle.sync();
  } catch {
    // Best effort; some filesystems do not support directory fsync.
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function lstatOrNull(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return null;
    }

    throw new CredentialFileReadError();
  }
}

/** Resolve the credential file under a caller-supplied Reasonix home. */
export function resolveReasonixEnvFile(homeDir: string): string {
  if (typeof homeDir !== "string" || homeDir.trim() === "") {
    throw new TypeError("homeDir must be a non-empty string");
  }

  return join(resolve(homeDir), ".env");
}

/**
 * Write-only credential store for Reasonix's official `.env` file.
 * It never returns, logs, or attaches a secret value to an error.
 */
export class ReasonixEnvFileStore implements CredentialStore {
  private readonly homeDir: string;
  private readonly envFilePath: string;
  private readonly lockPath: string;
  private readonly recoveryPath: string;
  private readonly lockTimeoutMs: number;
  private readonly staleLockMs: number;
  private readonly retryDelayMs: number;
  private readonly beforeCommit?: () => Promise<void> | void;
  private readonly beforeStaleRecovery?: () => Promise<void> | void;

  constructor(options: ReasonixEnvFileStoreOptions) {
    if (
      typeof options.homeDir !== "string" ||
      options.homeDir.trim() === ""
    ) {
      throw new TypeError("homeDir must be a non-empty string");
    }

    this.homeDir = resolve(options.homeDir);
    this.envFilePath = join(this.homeDir, ".env");
    this.lockPath = join(this.homeDir, ".env.lock");
    this.recoveryPath = join(this.homeDir, ".env.lock.recover");
    this.lockTimeoutMs = positive(options.lockTimeoutMs ?? 5_000, "lockTimeoutMs");
    this.staleLockMs = positive(options.staleLockMs ?? 30_000, "staleLockMs");
    this.retryDelayMs = positive(options.retryDelayMs ?? 25, "retryDelayMs");
    this.beforeCommit = options.beforeCommit;
    this.beforeStaleRecovery = options.beforeStaleRecovery;
  }

  /** Presence only. This never proves the credential is valid. */
  async status(ref: CredentialRef): Promise<CredentialStatus> {
    this.validateRef(ref);

    if ((await this.readHome()) === null) {
      return "missing";
    }

    const snapshot = await this.readTarget();

    if (snapshot === null) {
      return "missing";
    }

    const parsed = parseEnvFile(snapshot.content);
    const entry = parsed.entries.get(ref.apiKeyEnv);

    return entry && entry.value !== undefined && entry.value.length > 0
      ? "present"
      : "missing";
  }

  async set(ref: CredentialRef, secret: string): Promise<void> {
    this.validateRef(ref);
    this.validateSecret(secret);

    await this.withLock(async (home) => {
      const snapshot = await this.readTarget();
      const parsed = parseEnvFile(snapshot?.content ?? "");
      const next = applySet(parsed, ref.apiKeyEnv, secret);

      await this.commit(next, snapshot, home);
    });
  }

  async remove(ref: CredentialRef): Promise<void> {
    this.validateRef(ref);

    await this.withLock(async (home) => {
      const snapshot = await this.readTarget();

      if (snapshot === null) {
        return;
      }

      const parsed = parseEnvFile(snapshot.content);

      if (!parsed.entries.has(ref.apiKeyEnv)) {
        return;
      }

      await this.commit(applyRemove(parsed, ref.apiKeyEnv), snapshot, home);
    });
  }

  private validateRef(ref: CredentialRef): void {
    const errors = validateCredentialRef(ref);

    if (errors.length > 0) {
      throw new InvalidCredentialRefError(errors);
    }
  }

  private validateSecret(secret: string): void {
    if (
      typeof secret !== "string" ||
      secret.length === 0 ||
      !SECRET_PATTERN.test(secret)
    ) {
      throw new InvalidCredentialSecretError();
    }
  }

  private async readHome(): Promise<Stats | null> {
    let homeStat: Stats;

    try {
      homeStat = await lstat(this.homeDir);
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        return null;
      }

      throw new CredentialFileReadError();
    }

    if (homeStat.isSymbolicLink()) {
      throw new UnsafeCredentialPathError(
        "Reasonix home must not be a symlink.",
      );
    }

    if (!homeStat.isDirectory()) {
      throw new UnsafeCredentialPathError("Reasonix home is not a directory.");
    }

    return homeStat;
  }

  private async requireHome(): Promise<HomeIdentity> {
    const home = await this.readHome();

    if (home === null) {
      throw new UnsafeCredentialPathError("Reasonix home does not exist.");
    }

    return { dev: home.dev, ino: home.ino };
  }

  private async verifyHomeIdentity(expected: HomeIdentity): Promise<void> {
    // Node path APIs cannot pin a directory handle, so a hostile parent-path
    // swap can still race the final rename. The final home symlink is rejected.
    const current = await this.readHome();

    if (
      current === null ||
      current.dev !== expected.dev ||
      current.ino !== expected.ino
    ) {
      throw new UnsafeCredentialPathError(
        "Reasonix home changed during the operation.",
      );
    }
  }

  private async withLock<T>(
    operation: (home: HomeIdentity) => Promise<T>,
  ): Promise<T> {
    const home = await this.requireHome();
    const token = await this.acquireLock();

    try {
      await this.verifyHomeIdentity(home);
      await this.cleanupStaleTemporaryFiles();
      return await operation(home);
    } finally {
      await this.releaseLock(token);
    }
  }

  private async cleanupStaleTemporaryFiles(): Promise<void> {
    // Only known temp names with a dead owner are eligible. A hard crash can
    // still leave a 0600 temp containing the secret until the next write.
    let entries: string[];

    try {
      entries = await readdir(this.homeDir);
    } catch {
      return;
    }

    const now = Date.now();

    for (const name of entries) {
      const match = TEMP_NAME_PATTERN.exec(name);

      if (!match) {
        continue;
      }

      const ownerPid = Number(match[1]);

      if (
        !Number.isInteger(ownerPid) ||
        ownerPid <= 0 ||
        processIsAlive(ownerPid)
      ) {
        continue;
      }

      const path = join(this.homeDir, name);

      try {
        const temporaryStat = await lstat(path);

        if (
          temporaryStat.isFile() &&
          now - temporaryStat.mtimeMs > this.staleLockMs
        ) {
          await unlink(path);
        }
      } catch {
        // Best effort; a live writer is excluded by the lock and PID check.
      }
    }
  }

  private async recoveryMarkerExists(): Promise<boolean> {
    // A marker is never auto-removed. A crashed recoverer times out safely.
    const markerStat = await lstatOrNull(this.recoveryPath);

    if (markerStat === null) {
      return false;
    }

    if (markerStat.isSymbolicLink() || !markerStat.isFile()) {
      throw new UnsafeCredentialPathError(
        "Credential recovery marker is not a regular file.",
      );
    }

    return true;
  }

  private async acquireLock(): Promise<string> {
    const token = randomUUID();
    const deadline = Date.now() + this.lockTimeoutMs;

    while (true) {
      if (await this.recoveryMarkerExists()) {
        if (Date.now() >= deadline) {
          throw new CredentialLockError(this.lockTimeoutMs);
        }

        await sleep(this.retryDelayMs);
        continue;
      }

      let handle: Awaited<ReturnType<typeof open>> | undefined;
      let created = false;

      try {
        handle = await open(this.lockPath, LOCK_FLAGS, 0o600);
        created = true;

        if (process.platform !== "win32") {
          await handle.chmod(0o600);
        }

        await handle.writeFile(`${token} ${process.pid}\n`, {
          encoding: "utf8",
        });
        await handle.sync();
        await handle.close();
      } catch (error) {
        if (handle) {
          await handle.close().catch(() => {});
        }

        if (created) {
          await unlink(this.lockPath).catch(() => {});
        }

        const code = errorCode(error);

        if (code === "EEXIST") {
          if (await this.clearStaleLock()) {
            continue;
          }

          if (Date.now() >= deadline) {
            throw new CredentialLockError(this.lockTimeoutMs);
          }

          await sleep(this.retryDelayMs);
          continue;
        }

        if (code === "ELOOP") {
          throw new UnsafeCredentialPathError(
            "Credential lock path is a symlink.",
          );
        }

        throw new CredentialFileWriteError();
      }

      try {
        if (await this.recoveryMarkerExists()) {
          await this.releaseLock(token);

          if (Date.now() >= deadline) {
            throw new CredentialLockError(this.lockTimeoutMs);
          }

          await sleep(this.retryDelayMs);
          continue;
        }

        return token;
      } catch (error) {
        await this.releaseLock(token);
        throw error;
      }
    }
  }

  private async claimRecoveryMarker(): Promise<string | null> {
    // The marker serializes stale-lock replacement across store instances.
    const token = randomUUID();
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let created = false;

    try {
      handle = await open(this.recoveryPath, LOCK_FLAGS, 0o600);
      created = true;

      if (process.platform !== "win32") {
        await handle.chmod(0o600);
      }

      await handle.writeFile(`${token} ${process.pid}\n`, {
        encoding: "utf8",
      });
      await handle.sync();
      await handle.close();
      return token;
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => {});
      }

      if (created) {
        await unlink(this.recoveryPath).catch(() => {});
      }

      const code = errorCode(error);

      if (code === "EEXIST") {
        return null;
      }

      if (code === "ELOOP") {
        throw new UnsafeCredentialPathError(
          "Credential recovery marker path is a symlink.",
        );
      }

      throw new CredentialFileWriteError();
    }
  }

  private async clearStaleLock(): Promise<boolean> {
    const recoveryToken = await this.claimRecoveryMarker();

    if (recoveryToken === null) {
      return false;
    }

    try {
      await this.beforeStaleRecovery?.();

      const lockStat = await lstatOrNull(this.lockPath);

      if (lockStat === null) {
        return true;
      }

      if (lockStat.isSymbolicLink() || !lockStat.isFile()) {
        throw new UnsafeCredentialPathError(
          "Credential lock path is not a regular file.",
        );
      }

      let content: string | null;

      try {
        content = await readSmallText(this.lockPath);
      } catch (error) {
        if (error instanceof UnsafeCredentialPathError) {
          throw error;
        }

        return false;
      }

      if (content === null) {
        return true;
      }

      const [lockToken, pidText] = content.trim().split(/\s+/);
      const ownerPid = Number(pidText);

      if (
        !lockToken ||
        !Number.isInteger(ownerPid) ||
        ownerPid <= 0 ||
        processIsAlive(ownerPid)
      ) {
        return false;
      }

      if (Date.now() - lockStat.mtimeMs < this.staleLockMs) {
        return false;
      }

      try {
        await unlink(this.lockPath);
      } catch (error) {
        if (errorCode(error) === "ENOENT") {
          return true;
        }

        throw new CredentialFileWriteError();
      }

      return true;
    } finally {
      await this.releaseOwnedLock(this.recoveryPath, recoveryToken);
    }
  }

  private async releaseLock(token: string): Promise<void> {
    await this.releaseOwnedLock(this.lockPath, token);
  }

  private async releaseOwnedLock(path: string, token: string): Promise<void> {
    try {
      const lockStat = await lstatOrNull(path);

      if (
        lockStat === null ||
        lockStat.isSymbolicLink() ||
        !lockStat.isFile()
      ) {
        return;
      }

      const content = await readSmallText(path);

      if (content === null) {
        return;
      }

      const [lockToken] = content.trim().split(/\s+/);

      if (lockToken !== token) {
        return;
      }

      await unlink(path);
    } catch {
      // Release is best effort; a stale lock is handled by the next writer.
    }
  }

  private async readTarget(): Promise<Snapshot | null> {
    const targetStat = await lstatOrNull(this.envFilePath);

    if (targetStat === null) {
      return null;
    }

    if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
      throw new UnsafeCredentialPathError();
    }

    let handle: Awaited<ReturnType<typeof open>>;

    try {
      handle = await open(this.envFilePath, READ_FLAGS);
    } catch (error) {
      const code = errorCode(error);

      if (code === "ENOENT") {
        return null;
      }

      if (code === "ELOOP") {
        throw new UnsafeCredentialPathError();
      }

      throw new CredentialFileReadError();
    }

    try {
      const fileStat = await handle.stat();

      if (!fileStat.isFile()) {
        throw new UnsafeCredentialPathError();
      }

      const content = await handle.readFile({ encoding: "utf8" });

      return { content, hash: hashContent(content) };
    } catch (error) {
      if (error instanceof CredentialStoreError) {
        throw error;
      }

      throw new CredentialFileReadError();
    } finally {
      await handle.close().catch(() => {});
    }
  }

  private async commit(
    next: string,
    before: Snapshot | null,
    home: HomeIdentity,
  ): Promise<void> {
    await this.verifyHomeIdentity(home);

    const temporary = join(
      this.homeDir,
      `.env.tmp.${process.pid}.${randomUUID()}`,
    );
    let temporaryReady = false;

    try {
      await this.writeTemporary(temporary, next);
      temporaryReady = true;
      await this.beforeCommit?.();
      await this.verifyHomeIdentity(home);

      const current = await this.readTarget();

      if (!sameSnapshot(before, current)) {
        throw new CredentialWriteConflictError();
      }

      await this.verifyHomeIdentity(home);

      // POSIX rename replaces the target atomically. Windows may reject an
      // existing target; no non-atomic fallback is used in this stage.
      await rename(temporary, this.envFilePath);
      temporaryReady = false;
      await syncDirectory(this.homeDir);
    } catch (error) {
      if (temporaryReady) {
        await unlink(temporary).catch(() => {});
      }

      if (error instanceof CredentialStoreError) {
        throw error;
      }

      throw new CredentialFileWriteError();
    }
  }

  private async writeTemporary(path: string, content: string): Promise<void> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let created = false;

    try {
      handle = await open(path, WRITE_FLAGS, 0o600);
      created = true;

      if (process.platform !== "win32") {
        await handle.chmod(0o600);
      }

      await handle.writeFile(content, { encoding: "utf8" });
      await handle.sync();
    } catch (error) {
      if (created) {
        await unlink(path).catch(() => {});
      }

      throw error;
    } finally {
      await handle?.close().catch(() => {});
    }
  }
}
