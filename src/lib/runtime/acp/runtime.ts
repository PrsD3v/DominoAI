import type {
  AgentRuntime,
  CreateSessionRequest,
  PromptResult,
  RuntimeAgentInfo,
  RuntimeCapabilities,
  Session,
} from "@/types/runtime";
import { UnsupportedCapabilityError } from "../../../types/runtime";
import {
  ACP_PROTOCOL_VERSION,
  parseInitializeResult,
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
      async prompt(): Promise<PromptResult> {
        throw new Error("session/prompt is implemented in feature 4");
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

  return {
    capabilities,
    createSession,
    close,
  };
}
