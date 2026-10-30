import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveContainedStepPath,
  WorkspaceContainmentError,
} from "./containment";

let base: string;
let root: string;
let outside: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "domino-containment-"));
  root = join(base, "workspace");
  outside = join(base, "outside");
  await mkdir(root);
  await mkdir(outside);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("resolveContainedStepPath", () => {
  it("accepts the workspace root itself", async () => {
    await expect(
      resolveContainedStepPath({ workspaceRoot: root }),
    ).resolves.toBe(await realpath(root));
  });

  it("accepts a nested directory inside the root", async () => {
    const nested = join(root, "packages", "app");
    await mkdir(nested, { recursive: true });

    await expect(
      resolveContainedStepPath({
        workspaceRoot: root,
        workingDirectory: "packages/app",
      }),
    ).resolves.toBe(await realpath(nested));
  });

  it("refuses a parent-directory escape", async () => {
    await expect(
      resolveContainedStepPath({
        workspaceRoot: root,
        workingDirectory: "../outside",
      }),
    ).rejects.toMatchObject({
      name: "WorkspaceContainmentError",
      reason: "outside",
    });
  });

  it("refuses an absolute path", async () => {
    await expect(
      resolveContainedStepPath({
        workspaceRoot: root,
        workingDirectory: outside,
      }),
    ).rejects.toBeInstanceOf(WorkspaceContainmentError);

    await expect(
      resolveContainedStepPath({
        workspaceRoot: root,
        workingDirectory: outside,
      }),
    ).rejects.toMatchObject({ reason: "absolute" });
  });

  it("accepts a symlink whose target is inside the root", async () => {
    const target = join(root, "target");
    await mkdir(target);
    await symlink(target, join(root, "link"));

    await expect(
      resolveContainedStepPath({
        workspaceRoot: root,
        workingDirectory: "link",
      }),
    ).resolves.toBe(await realpath(target));
  });

  it("refuses a symlink whose target escapes the root", async () => {
    await symlink(outside, join(root, "escape"));

    await expect(
      resolveContainedStepPath({
        workspaceRoot: root,
        workingDirectory: "escape",
      }),
    ).rejects.toMatchObject({ reason: "outside" });
  });

  it("refuses a missing target", async () => {
    await expect(
      resolveContainedStepPath({
        workspaceRoot: root,
        workingDirectory: "missing",
      }),
    ).rejects.toMatchObject({ reason: "missing" });
  });

  it("refuses a missing root", async () => {
    await expect(
      resolveContainedStepPath({
        workspaceRoot: join(base, "missing-root"),
      }),
    ).rejects.toMatchObject({ reason: "missing" });
  });

  it("refuses a non-directory root", async () => {
    const fileRoot = join(base, "file-root");
    await writeFile(fileRoot, "not a directory");

    await expect(
      resolveContainedStepPath({ workspaceRoot: fileRoot }),
    ).rejects.toMatchObject({ reason: "not-directory" });
  });

  it("refuses a file as the step path", async () => {
    await writeFile(join(root, "file.txt"), "not a directory");

    await expect(
      resolveContainedStepPath({
        workspaceRoot: root,
        workingDirectory: "file.txt",
      }),
    ).rejects.toMatchObject({ reason: "not-directory" });
  });
});
