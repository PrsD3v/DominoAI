import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentRuntime } from "@/types/runtime";
import { createAcpRuntime } from "./runtime";

const liveIt = process.env.DOMINO_LIVE_ACP === "1" ? it : it.skip;

describe("installed Reasonix session list over the ACP runtime", () => {
  liveIt(
    "lists persisted session summaries without creating a session",
    async () => {
      const workspace = await mkdtemp(join(tmpdir(), "domino-live-acp-list-"));
      let runtime: AgentRuntime | undefined;

      try {
        runtime = await createAcpRuntime({
          command: process.env.DOMINO_REASONIX_BIN ?? "reasonix",
          args: [
            "acp",
            "--model",
            "deepseek/deepseek-flash",
            "--permission-mode",
            "ask",
          ],
          cwd: workspace,
        });

        expect(runtime.capabilities.sessions.list).toBe(true);

        const summaries = await runtime.listSessions();

        expect(Array.isArray(summaries)).toBe(true);

        for (const summary of summaries) {
          expect(summary.id.length).toBeGreaterThan(0);
          expect(summary.workspaceRoot.length).toBeGreaterThan(0);
          expect(typeof summary.title).toBe("string");
          expect(summary.updatedAt.length).toBeGreaterThan(0);
        }
      } finally {
        await runtime?.close();
        await rm(workspace, { recursive: true, force: true });
      }
    },
    20_000,
  );
});
