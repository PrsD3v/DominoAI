import type {
  AgentRuntime,
  CreateSessionRequest,
  LoadSessionRequest,
  PromptRequest,
  PromptResult,
  RuntimeAgentInfo,
  RuntimeCapabilities,
  Session,
  SessionOpenRequest,
  SessionSummary,
} from "@/types/runtime";
import { UnsupportedCapabilityError } from "../../../types/runtime";
import {
  ACP_PROTOCOL_VERSION,
  extractAgentTextChunk,
  parseInitializeResult,
  parsePromptResult,
  parseSessionListResult,
  parseSessionNewResult,
  type InitializeParams,
} from "./protocol";
import {
  startTransport,
  TransportClosedError,
  type Transport,
  type TransportOptions,
} from "./transport";

const DEFAULT_CLIENT_INFO: RuntimeAgentInfo = {
  name: "domino",
  version: "0.1.0",
};

export interface AcpRuntimeOptions extends TransportOptions {
  clientInfo?: RuntimeAgentInfo;
}

type RuntimeState = "open" | "closing" | "closed";

/** Start an ACP agent process, perform the handshake, and return its runtime. */
export async function createAcpRuntime(
  options: AcpRuntimeOptions,
): Promise<AgentRuntime> {
  const { clientInfo = DEFAULT_CLIENT_INFO, ...transportOptions } = options;
  const transport = await startTransport(transportOptions);

  let capabilities: RuntimeCapabilities;

  try {
    capabilities = await initialize(transport, clientInfo);
  } catch (error) {
    await transport.close();
    throw error;
  }

  return createRuntime(transport, capabilities);
}

async function initialize(
  transport: Transport,
  clientInfo: RuntimeAgentInfo,
): Promise<RuntimeCapabilities> {
  const params: InitializeParams = {
    protocolVersion: ACP_PROTOCOL_VERSION,
    clientInfo,
    clientCapabilities: {},
  };

  const result = await transport.request<unknown>("initialize", params);
  const capabilities = parseInitializeResult(result);

  transport.notify("initialized", {});

  return capabilities;
}

function createRuntime(
  transport: Transport,
  capabilities: RuntimeCapabilities,
): AgentRuntime {
  let state: RuntimeState = "open";
  let shutdown: Promise<void> | null = null;

  const assertOpen = (method: string) => {
    if (state !== "open") {
      throw new TransportClosedError(method, { kind: "shutdown" });
    }
  };

  const close = (): Promise<void> => {
    if (shutdown) {
      return shutdown;
    }

    state = "closing";
    shutdown = transport.close().then(
      () => {
        state = "closed";
      },
      (error: unknown) => {
        state = "closed";
        throw error;
      },
    );

    return shutdown;
  };

  const createSessionObject = (id: string): Session => {
    let closed = false;
    let closing: Promise<void> | null = null;
    let prompting = false;
    let cancelSent = false;

    const closeSession = (): Promise<void> => {
      if (closed) {
        return Promise.resolve();
      }

      if (!capabilities.sessions.close) {
        return Promise.reject(new UnsupportedCapabilityError("sessions.close"));
      }

      if (closing) {
        return closing;
      }

      if (state !== "open") {
        return Promise.reject(
          new TransportClosedError("session/close", { kind: "shutdown" }),
        );
      }

      closing = transport.request("session/close", { sessionId: id }).then(
        () => {
          closed = true;
          closing = null;
        },
        (error: unknown) => {
          closing = null;
          throw error;
        },
      );

      return closing;
    };

    return {
      id,
      async prompt(request: PromptRequest): Promise<PromptResult> {
        assertOpen("session/prompt");

        if (closed) {
          throw new Error("Cannot prompt: session is closed");
        }

        if (prompting) {
          throw new Error("Cannot prompt: session already has an active prompt");
        }

        prompting = true;
        cancelSent = false;

        const chunks: string[] = [];

        const unsubscribe = transport.onNotification((method, params) => {
          if (method !== "session/update") {
            return;
          }

          const text = extractAgentTextChunk(id, params);

          if (text === null) {
            return;
          }

          chunks.push(text);
          request.onEvent({ type: "assistant_text_delta", text });
        });

        try {
          const result = await transport.request<unknown>("session/prompt", {
            sessionId: id,
            prompt: [{ type: "text", text: request.text }],
          });

          return {
            text: chunks.join(""),
            stopReason: parsePromptResult(result),
          };
        } finally {
          unsubscribe();
          prompting = false;
          cancelSent = false;
        }
      },
      cancel(): void {
        if (state !== "open" || closed || !prompting || cancelSent) {
          return;
        }

        cancelSent = true;
        transport.notify("session/cancel", { sessionId: id });
      },
      close: closeSession,
    };
  };

  const createSession = async (
    request: CreateSessionRequest,
  ): Promise<Session> => {
    assertOpen("session/new");

    const result = await transport.request<unknown>("session/new", {
      cwd: request.workspaceRoot,
      mcpServers: [],
    });

    assertOpen("session/new");

    return createSessionObject(parseSessionNewResult(result));
  };

  const listSessions = async (): Promise<SessionSummary[]> => {
    assertOpen("session/list");

    if (!capabilities.sessions.list) {
      throw new UnsupportedCapabilityError("sessions.list");
    }

    const result = await transport.request<unknown>("session/list", {});

    return parseSessionListResult(result);
  };

  const resumeSession = async (
    request: SessionOpenRequest,
  ): Promise<Session> => {
    assertOpen("session/resume");

    if (!capabilities.sessions.resume) {
      throw new UnsupportedCapabilityError("sessions.resume");
    }

    await transport.request("session/resume", {
      sessionId: request.sessionId,
      cwd: request.workspaceRoot,
      mcpServers: [],
    });

    assertOpen("session/resume");

    return createSessionObject(request.sessionId);
  };

  const loadSession = async (
    request: LoadSessionRequest,
  ): Promise<Session> => {
    assertOpen("session/load");

    if (!capabilities.loadSession) {
      throw new UnsupportedCapabilityError("loadSession");
    }

    const unsubscribe = transport.onNotification((method, params) => {
      if (method !== "session/update") {
        return;
      }

      const text = extractAgentTextChunk(request.sessionId, params);

      if (text === null) {
        return;
      }

      request.onEvent({ type: "assistant_text_delta", text });
    });

    try {
      await transport.request("session/load", {
        sessionId: request.sessionId,
        cwd: request.workspaceRoot,
        mcpServers: [],
      });
    } finally {
      unsubscribe();
    }

    assertOpen("session/load");

    return createSessionObject(request.sessionId);
  };

  return {
    capabilities,
    listSessions,
    createSession,
    resumeSession,
    loadSession,
    close,
  };
}
