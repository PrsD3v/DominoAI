import { spawn } from "node:child_process";
import {
  createLineDecoder,
  JsonRpcParseError,
  parseJsonRpcMessage,
  serializeJsonRpcMessage,
  type JsonRpcErrorObject,
  type JsonRpcMessage,
  type JsonRpcNotificationMessage,
  type JsonRpcRequestMessage,
} from "./json-rpc";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_SHUTDOWN_GRACE_MS = 2_000;
const EOF_EXIT_GRACE_MS = 100;

/** How a transport stopped. Resolved once through `closed`. */
export type TransportClose =
  | { kind: "shutdown" }
  | { kind: "exit"; code: number | null; signal: NodeJS.Signals | null }
  | { kind: "protocol"; error: JsonRpcParseError };

export interface TransportOptions {
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  shutdownGraceMs?: number;
}

export interface RequestOptions {
  timeoutMs?: number;
}

export type NotificationListener = (method: string, params: unknown) => void;

export type RequestHandler = (
  method: string,
  params: unknown,
) => unknown | Promise<unknown>;

export interface Transport {
  readonly closed: Promise<TransportClose>;
  request<T = unknown>(
    method: string,
    params?: unknown,
    options?: RequestOptions,
  ): Promise<T>;
  notify(method: string, params?: unknown): void;
  onNotification(listener: NotificationListener): () => void;
  onRequest(handler: RequestHandler): () => void;
  close(): Promise<void>;
}

export class TransportClosedError extends Error {
  readonly method: string;
  readonly close: TransportClose;

  constructor(method: string, close: TransportClose) {
    super(`Transport is closed (${close.kind}) while sending "${method}"`);
    this.name = "TransportClosedError";
    this.method = method;
    this.close = close;
  }
}

export class TransportTimeoutError extends Error {
  readonly method: string;
  readonly timeoutMs: number;

  constructor(method: string, timeoutMs: number) {
    super(`Request "${method}" timed out after ${timeoutMs} ms`);
    this.name = "TransportTimeoutError";
    this.method = method;
    this.timeoutMs = timeoutMs;
  }
}

export class JsonRpcError extends Error {
  readonly method: string;
  readonly code: number;
  readonly data: unknown;

  constructor(method: string, error: JsonRpcErrorObject) {
    super(error.message);
    this.name = "JsonRpcError";
    this.method = method;
    this.code = error.code;
    this.data = error.data;
  }
}

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/** Start an agent process over stdio and own its lifetime. */
export async function startTransport(
  options: TransportOptions,
): Promise<Transport> {
  const child = spawn(options.command, [...(options.args ?? [])], {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  await new Promise<void>((resolve, reject) => {
    const onSpawn = () => {
      child.off("error", onError);
      resolve();
    };
    const onError = (error: Error) => {
      child.off("spawn", onSpawn);
      reject(error);
    };

    child.once("spawn", onSpawn);
    child.once("error", onError);
  });

  const requestTimeoutMs =
    options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const graceMs = options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;

  const pending = new Map<string, PendingRequest>();
  const notificationListeners = new Set<NotificationListener>();
  const decoder = createLineDecoder();
  let requestHandler: RequestHandler | null = null;
  let nextId = 1;

  let outcome: TransportClose | null = null;
  let resolveClosed: (value: TransportClose) => void = () => {};
  const closed = new Promise<TransportClose>((resolve) => {
    resolveClosed = resolve;
  });

  let resolveExited: () => void = () => {};
  const exited = new Promise<void>((resolve) => {
    resolveExited = resolve;
  });

  const settle = (value: TransportClose) => {
    if (outcome) {
      return;
    }

    outcome = value;

    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new TransportClosedError(entry.method, value));
    }
    pending.clear();

    resolveClosed(value);
  };

  const write = (message: JsonRpcMessage) => {
    if (outcome) {
      return;
    }

    try {
      child.stdin.write(`${serializeJsonRpcMessage(message)}\n`);
    } catch {
      // A broken pipe surfaces through the stream error handler, which ends the child.
    }
  };

  const handleIncomingRequest = async (message: JsonRpcRequestMessage) => {
    const handler = requestHandler;

    if (!handler) {
      write({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: "Method not found" },
      });
      return;
    }

    try {
      const result = await handler(message.method, message.params);

      write({ jsonrpc: "2.0", id: message.id, result: result ?? null });
    } catch {
      write({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32603, message: "Internal error" },
      });
    }
  };

  const dispatchNotification = (message: JsonRpcNotificationMessage) => {
    for (const listener of [...notificationListeners]) {
      try {
        listener(message.method, message.params);
      } catch {
        // One listener cannot stop the others or the read loop.
      }
    }
  };

  const handleMessage = (message: JsonRpcMessage) => {
    if ("method" in message) {
      if ("id" in message) {
        void handleIncomingRequest(message);
        return;
      }

      dispatchNotification(message);
      return;
    }

    const key = String(message.id);
    const entry = pending.get(key);

    if (!entry) {
      return;
    }

    pending.delete(key);
    clearTimeout(entry.timer);

    if ("error" in message) {
      entry.reject(new JsonRpcError(entry.method, message.error));
      return;
    }

    entry.resolve(message.result);
  };

  child.once("exit", (code, signal) => {
    settle({ kind: "exit", code, signal });
    resolveExited();
  });

  child.on("error", () => {
    if (!outcome) {
      child.kill("SIGKILL");
    }
  });

  // An unread pipe fills up and blocks the child, so every stream is drained.
  child.stdout.setEncoding("utf8");
  child.stdout.on("error", () => {});
  child.stdout.on("data", (chunk: string) => {
    for (const line of decoder.push(chunk)) {
      let message: JsonRpcMessage;

      try {
        message = parseJsonRpcMessage(line);
      } catch (error) {
        settle({
          kind: "protocol",
          error:
            error instanceof JsonRpcParseError
              ? error
              : new JsonRpcParseError(String(error)),
        });
        child.kill("SIGKILL");
        return;
      }

      handleMessage(message);
    }
  });

  // Output ended, so no response can arrive. Give a dying child a moment to
  // report its real exit code before the connection is torn down.
  child.stdout.on("end", () => {
    if (outcome) {
      return;
    }

    const killTimer = setTimeout(() => {
      if (!outcome) {
        child.kill("SIGKILL");
      }
    }, EOF_EXIT_GRACE_MS);

    child.once("exit", () => clearTimeout(killTimer));
  });

  child.stderr.on("error", () => {});
  child.stderr.resume();

  child.stdin.on("error", () => {
    if (!outcome) {
      child.kill("SIGKILL");
    }
  });

  function request<T = unknown>(
    method: string,
    params?: unknown,
    requestOptions: RequestOptions = {},
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (outcome) {
        reject(new TransportClosedError(method, outcome));
        return;
      }

      const timeoutMs = requestOptions.timeoutMs ?? requestTimeoutMs;

      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        reject(
          new RangeError(
            `timeoutMs must be a positive number, received ${timeoutMs}`,
          ),
        );
        return;
      }

      const id = nextId;
      nextId += 1;

      const timer = setTimeout(() => {
        pending.delete(String(id));
        reject(new TransportTimeoutError(method, timeoutMs));
      }, timeoutMs);

      pending.set(String(id), {
        method,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      write({
        jsonrpc: "2.0",
        id,
        method,
        ...(params === undefined ? {} : { params }),
      });
    });
  }

  function notify(method: string, params?: unknown): void {
    if (outcome) {
      throw new TransportClosedError(method, outcome);
    }

    write({
      jsonrpc: "2.0",
      method,
      ...(params === undefined ? {} : { params }),
    });
  }

  function onNotification(listener: NotificationListener): () => void {
    notificationListeners.add(listener);

    return () => {
      notificationListeners.delete(listener);
    };
  }

  function onRequest(handler: RequestHandler): () => void {
    if (requestHandler) {
      throw new Error("A request handler is already registered");
    }

    requestHandler = handler;

    return () => {
      if (requestHandler === handler) {
        requestHandler = null;
      }
    };
  }

  async function close(): Promise<void> {
    if (outcome) {
      await exited;
      return;
    }

    settle({ kind: "shutdown" });

    if (!child.stdin.destroyed) {
      child.stdin.end();
    }

    const killTimer = setTimeout(() => child.kill("SIGKILL"), graceMs);
    await exited;
    clearTimeout(killTimer);
  }

  return { closed, request, notify, onNotification, onRequest, close };
}
