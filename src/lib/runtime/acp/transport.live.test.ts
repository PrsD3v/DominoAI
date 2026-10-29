import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JsonRpcError, startTransport } from "./transport";

const liveIt = process.env.DOMINO_LIVE_ACP === "1" ? it : it.skip;

describe("installed Reasonix over the transport", () => {
  liveIt(
    "correlates a request with the runtime error response",
    async () => {
      const workspace = await mkdtemp(join(tmpdir(), "domino-live-acp-"));
      const transport = await startTransport({
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

      try {
        const error = await transport
          .request("domino/transport-probe", {}, { timeoutMs: 15_000 })
          .catch((reason) => reason);

        expect(error).toBeInstanceOf(JsonRpcError);
        expect(error).toMatchObject({
          method: "domino/transport-probe",
          code: -32601,
        });
        expect((error as JsonRpcError).message).toContain("method not found");
      } finally {
        await transport.close();
        await rm(workspace, { recursive: true, force: true });
      }

      await expect(transport.closed).resolves.toEqual({ kind: "shutdown" });
    },
    20_000,
  );
});
