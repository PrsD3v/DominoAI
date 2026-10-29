/** Normalized reason a prompt stopped. Extend only when a later feature proves a value. */
export type PromptStopReason = "completed" | "cancelled";

/** Normalized runtime event delivered while a prompt runs. */
export type RuntimeEvent = {
  type: "assistant_text_delta";
  text: string;
};

export interface CreateSessionRequest {
  workspaceRoot: string;
}

export interface PromptRequest {
  text: string;
  onEvent: (event: RuntimeEvent) => void;
}

export interface PromptResult {
  text: string;
  stopReason: PromptStopReason;
}

export interface Session {
  readonly id: string;
  prompt(request: PromptRequest): Promise<PromptResult>;
}

export interface AgentRuntime {
  createSession(request: CreateSessionRequest): Promise<Session>;
}
