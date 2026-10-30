/** Normalized reason a prompt stopped. Extend only when a later feature proves a value. */
export type PromptStopReason = "completed" | "cancelled";

/** Normalized runtime event delivered while a prompt runs. */
export type RuntimeEvent = {
  type: "assistant_text_delta";
  text: string;
};

/** Identity a runtime reports for itself during a handshake. */
export interface RuntimeAgentInfo {
  readonly name: string;
  readonly version: string;
}

/** Session operations the runtime advertised as available. */
export interface RuntimeSessionCapabilities {
  readonly list: boolean;
  readonly resume: boolean;
  readonly close: boolean;
}

/** Capabilities reported by the runtime handshake. Missing capabilities stay false. */
export interface RuntimeCapabilities {
  readonly protocolVersion: number;
  readonly agent: RuntimeAgentInfo | null;
  readonly loadSession: boolean;
  readonly sessions: RuntimeSessionCapabilities;
}

/** Raised when a caller asks for an operation the runtime did not advertise. */
export class UnsupportedCapabilityError extends Error {
  readonly capability: string;

  constructor(capability: string) {
    super(`Runtime does not support capability "${capability}"`);
    this.name = "UnsupportedCapabilityError";
    this.capability = capability;
  }
}

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
  /** Request cancellation of the active prompt; the prompt result is the only evidence. */
  cancel(): void;
  close(): Promise<void>;
}

export interface AgentRuntime {
  readonly capabilities: RuntimeCapabilities;
  createSession(request: CreateSessionRequest): Promise<Session>;
  close(): Promise<void>;
}
