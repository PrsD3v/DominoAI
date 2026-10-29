export type JsonRpcId = number | string;

export interface JsonRpcRequestMessage {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotificationMessage {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: JsonRpcErrorObject;
}

export type JsonRpcMessage =
  | JsonRpcRequestMessage
  | JsonRpcNotificationMessage
  | JsonRpcSuccessResponse
  | JsonRpcErrorResponse;

export class JsonRpcParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonRpcParseError";
  }
}

export interface LineDecoder {
  push(chunk: string): string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is JsonRpcId {
  return (
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new JsonRpcParseError(message);
  }
}

/** Validate one JSON-RPC 2.0 message received on the wire. */
export function parseJsonRpcMessage(line: string): JsonRpcMessage {
  let value: unknown;

  try {
    value = JSON.parse(line);
  } catch (error) {
    throw new JsonRpcParseError(
      `Line is not valid JSON: ${(error as Error).message}`,
    );
  }

  ensure(isRecord(value), "Message must be a JSON object");
  ensure(value.jsonrpc === "2.0", 'Message must declare "jsonrpc": "2.0"');

  const hasMethod = "method" in value;
  const hasId = "id" in value;
  const hasResult = "result" in value;
  const hasError = "error" in value;
  const params = "params" in value ? { params: value.params } : {};

  if (hasMethod) {
    const method = value.method;
    ensure(
      typeof method === "string" && method.length > 0,
      "Method must be a non-empty string",
    );
    ensure(
      !hasResult && !hasError,
      "A request or notification cannot carry result or error",
    );

    if (!hasId) {
      return { jsonrpc: "2.0", method, ...params };
    }

    const id = value.id;
    ensure(isId(id), "Request id must be a number or string");

    return { jsonrpc: "2.0", id, method, ...params };
  }

  ensure(hasId, "Message needs a method or an id");

  const id = value.id;
  ensure(isId(id), "Response id must be a number or string");
  ensure(
    hasResult !== hasError,
    "Response must carry exactly one of result or error",
  );

  if (!hasError) {
    return { jsonrpc: "2.0", id, result: value.result };
  }

  const error = value.error;
  ensure(isRecord(error), "Error must be an object");

  const code = error.code;
  const message = error.message;
  ensure(
    typeof code === "number" && Number.isFinite(code),
    "Error code must be a number",
  );
  ensure(typeof message === "string", "Error message must be a string");

  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...("data" in error ? { data: error.data } : {}),
    },
  };
}

/** Serialize one message for a single newline-delimited frame. */
export function serializeJsonRpcMessage(message: JsonRpcMessage): string {
  return JSON.stringify(message);
}

/** Reassemble newline-delimited messages from arbitrary stream chunks. */
export function createLineDecoder(): LineDecoder {
  let buffer = "";

  return {
    push(chunk: string): string[] {
      buffer += chunk;

      const lines: string[] = [];
      let newline = buffer.indexOf("\n");

      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);

        if (line.length > 0) {
          lines.push(line);
        }

        newline = buffer.indexOf("\n");
      }

      return lines;
    },
  };
}
