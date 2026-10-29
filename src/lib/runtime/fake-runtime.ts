import type {
  AgentRuntime,
  PromptRequest,
  PromptResult,
  PromptStopReason,
  Session,
} from "@/types/runtime";

export interface FakeTurn {
  deltas: string[];
  stopReason?: PromptStopReason;
}

/** Build a deterministic runtime that replays scripted turns without spawning anything. */
export function createFakeRuntime(turns: FakeTurn[] = []): AgentRuntime {
  let sessionCount = 0;
  let turnIndex = 0;

  return {
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
      };
    },
  };
}
