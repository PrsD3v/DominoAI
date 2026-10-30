import type {
  PromptStopReason,
  RuntimeAgentInfo,
  RuntimeCapabilities,
  SessionSummary,
} from "@/types/runtime";

/** ACP protocol version this adapter understands. */
export const ACP_PROTOCOL_VERSION = 1;

/** Parameters sent with `initialize`. */
export interface InitializeParams {
  protocolVersion: number;
  clientInfo: RuntimeAgentInfo;
  clientCapabilities: Record<string, never>;
}

export class AcpProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcpProtocolError";
  }
}

export class AcpUnsupportedProtocolError extends AcpProtocolError {
  readonly reportedVersion: number;
  readonly supportedVersion: number;

  constructor(reportedVersion: number, supportedVersion: number) {
    super(
      `Unsupported ACP protocol version ${reportedVersion}; expected ${supportedVersion}`,
    );
    this.name = "AcpUnsupportedProtocolError";
    this.reportedVersion = reportedVersion;
    this.supportedVersion = supportedVersion;
  }
}

export class AcpUnsupportedStopReasonError extends AcpProtocolError {
  readonly reportedStopReason: unknown;

  constructor(reportedStopReason: unknown) {
    super(
      `Unsupported ACP prompt stop reason: ${describeStopReason(reportedStopReason)}`,
    );
    this.name = "AcpUnsupportedStopReasonError";
    this.reportedStopReason = reportedStopReason;
  }
}

function describeStopReason(value: unknown): string {
  if (typeof value === "string") {
    return `"${value}"`;
  }

  return value === undefined ? "missing" : "a non-string value";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function normalizeAgent(value: unknown): RuntimeAgentInfo | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.name) ||
    !isNonEmptyString(value.version)
  ) {
    return null;
  }

  return { name: value.name, version: value.version };
}

function isSupportedCapability(value: unknown): boolean {
  return value === true || isRecord(value);
}

/** Normalize an `initialize` result into Domino capabilities. */
export function parseInitializeResult(value: unknown): RuntimeCapabilities {
  if (!isRecord(value)) {
    throw new AcpProtocolError("initialize result must be an object");
  }

  const protocolVersion = value.protocolVersion;

  if (
    typeof protocolVersion !== "number" ||
    !Number.isFinite(protocolVersion)
  ) {
    throw new AcpProtocolError(
      "initialize result must include a numeric protocolVersion",
    );
  }

  if (protocolVersion !== ACP_PROTOCOL_VERSION) {
    throw new AcpUnsupportedProtocolError(
      protocolVersion,
      ACP_PROTOCOL_VERSION,
    );
  }

  const agentCapabilities = isRecord(value.agentCapabilities)
    ? value.agentCapabilities
    : {};
  const sessionCapabilities = isRecord(agentCapabilities.sessionCapabilities)
    ? agentCapabilities.sessionCapabilities
    : {};

  return {
    protocolVersion,
    agent: normalizeAgent(value.agentInfo),
    loadSession: agentCapabilities.loadSession === true,
    sessions: {
      list: isSupportedCapability(sessionCapabilities.list),
      resume: isSupportedCapability(sessionCapabilities.resume),
      close: isSupportedCapability(sessionCapabilities.close),
    },
  };
}

/** Extract the session id from a `session/new` result. */
export function parseSessionNewResult(value: unknown): string {
  if (!isRecord(value)) {
    throw new AcpProtocolError("session/new result must be an object");
  }

  if (!isNonEmptyString(value.sessionId)) {
    throw new AcpProtocolError(
      "session/new result must include a non-empty sessionId",
    );
  }

  return value.sessionId;
}

/** Normalize a `session/list` result into Domino session summaries. */
export function parseSessionListResult(value: unknown): SessionSummary[] {
  if (!isRecord(value) || !Array.isArray(value.sessions)) {
    throw new AcpProtocolError(
      "session/list result must include a sessions array",
    );
  }

  return value.sessions.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new AcpProtocolError(
        `session/list entry ${index} must be an object`,
      );
    }

    const { sessionId, cwd, title, updatedAt } = entry;

    if (!isNonEmptyString(sessionId)) {
      throw new AcpProtocolError(
        `session/list entry ${index} must include a non-empty sessionId`,
      );
    }

    if (!isNonEmptyString(cwd)) {
      throw new AcpProtocolError(
        `session/list entry ${index} must include a non-empty cwd`,
      );
    }

    if (typeof title !== "string") {
      throw new AcpProtocolError(
        `session/list entry ${index} must include a string title`,
      );
    }

    if (!isNonEmptyString(updatedAt)) {
      throw new AcpProtocolError(
        `session/list entry ${index} must include a non-empty updatedAt`,
      );
    }

    return {
      id: sessionId,
      workspaceRoot: cwd,
      title,
      updatedAt,
    };
  });
}

/**
 * Normalize the stop reason from a `session/prompt` result.
 *
 * Only the two proven reasons map to a Domino stop reason. Anything else fails
 * instead of being reported as a completed turn.
 */
export function parsePromptResult(value: unknown): PromptStopReason {
  const stopReason = isRecord(value) ? value.stopReason : undefined;

  if (stopReason === "end_turn") {
    return "completed";
  }

  if (stopReason === "cancelled") {
    return "cancelled";
  }

  throw new AcpUnsupportedStopReasonError(stopReason);
}

/**
 * Extract the text of a `session/update` text chunk for one session.
 *
 * Returns `null` for another session, a different update kind, or a payload
 * without text. The raw ACP update never leaves the adapter.
 */
export function extractAgentTextChunk(
  sessionId: string,
  params: unknown,
): string | null {
  if (!isRecord(params) || params.sessionId !== sessionId) {
    return null;
  }

  const update = params.update;

  if (!isRecord(update) || update.sessionUpdate !== "agent_message_chunk") {
    return null;
  }

  const content = update.content;

  if (!isRecord(content) || typeof content.text !== "string") {
    return null;
  }

  return content.text;
}
