import type { RuntimeAgentInfo, RuntimeCapabilities } from "@/types/runtime";

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
