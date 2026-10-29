import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentRuntime } from "@/types/runtime";
import { createAcpRuntime } from "./runtime";

const liveIt = process.env.DOMINO_LIVE_ACP === "1" ? it : it.skip;

describe("installed Reasonix over the ACP runtime", () => {
  liveIt(
    "handshakes, creates a session, and closes it without sending a prompt",
    async () => {
      const workspace = await mkdtemp(
        join(tmpdir(), "domino-live-acp-runtime-"),
      );
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

        expect(runtime.capabilities.protocolVersion).toBe(1);
        expect(runtime.capabilities.agent?.name).toBe("reasonix");
        expect(runtime.capabilities.sessions.close).toBe(true);

        const session = await runtime.createSession({
          workspaceRoot: workspace,
        });

        expect(session.id.length).toBeGreaterThan(0);

        await session.close();
      } finally {
        await runtime?.close();
        await rm(workspace, { recursive: true, force: true });
      }
    },
    20_000,
  );
});
