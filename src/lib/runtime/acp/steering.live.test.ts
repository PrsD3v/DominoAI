import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentRuntime } from "@/types/runtime";
import { createAcpRuntime } from "./runtime";

const liveIt = process.env.DOMINO_LIVE_ACP === "1" ? it : it.skip;

describe("installed Reasonix steering over the ACP runtime", () => {
  liveIt(
    "steers an active prompt through the advertised method",
    async () => {
      const workspace = await mkdtemp(join(tmpdir(), "domino-live-acp-steer-"));
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

        expect(runtime.capabilities.steering).toBe(true);

        const session = await runtime.createSession({
          workspaceRoot: workspace,
        });
        let steering: Promise<void> | null = null;

        const result = await session.prompt({
          text: "Write a detailed explanation of HTTP in 12 numbered sections. Do not use tools.",
          onEvent: () => {
            if (!steering) {
              steering = session.steer(
                "Stop and reply with exactly: ACP steer test passed.",
              );
            }
          },
        });

        await expect(steering).resolves.toBeUndefined();
        expect(typeof result.text).toBe("string");
        expect(["completed", "cancelled"]).toContain(result.stopReason);

        await session.close();
      } finally {
        await runtime?.close();
        await rm(workspace, { recursive: true, force: true });
      }
    },
    90_000,
  );
});
