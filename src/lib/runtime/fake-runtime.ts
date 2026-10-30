import type {
  AgentRuntime,
  PromptRequest,
  PromptResult,
  PromptStopReason,
  RuntimeCapabilities,
  Session,
  SessionSummary,
} from "@/types/runtime";
import { UnsupportedCapabilityError } from "../../types/runtime";

export interface FakeTurn {
  deltas: string[];
  stopReason?: PromptStopReason;
}

const FAKE_CAPABILITIES: RuntimeCapabilities = {
  protocolVersion: 1,
  agent: { name: "fake", version: "1.0.0" },
  loadSession: false,
  sessions: { list: false, resume: false, close: true },
};

/** Build a deterministic runtime that replays scripted turns without spawning anything. */
export function createFakeRuntime(turns: FakeTurn[] = []): AgentRuntime {
  let sessionCount = 0;
  let turnIndex = 0;

  return {
    capabilities: FAKE_CAPABILITIES,
    async listSessions(): Promise<SessionSummary[]> {
      throw new UnsupportedCapabilityError("sessions.list");
    },
    async createSession(): Promise<Session> {
      sessionCount += 1;

      return {
        id: `fake-session-${sessionCount}`,
        async prompt(request: PromptRequest): Promise<PromptResult> {
          const turn = turns[turnIndex];

          if (!turn) {
            throw new Error("fake runtime has no scripted turn");
          }

          turnIndex += 1;

          for (const delta of turn.deltas) {
            request.onEvent({ type: "assistant_text_delta", text: delta });
          }

          return {
            text: turn.deltas.join(""),
            stopReason: turn.stopReason ?? "completed",
          };
        },
        cancel(): void {},
        async close(): Promise<void> {},
      };
    },
    async resumeSession(): Promise<Session> {
      throw new UnsupportedCapabilityError("sessions.resume");
    },
    async loadSession(): Promise<Session> {
      throw new UnsupportedCapabilityError("loadSession");
    },
    async close(): Promise<void> {},
  };
}
