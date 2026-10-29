import { describe, expect, it } from "vitest";
import {
  createLineDecoder,
  JsonRpcParseError,
  parseJsonRpcMessage,
  serializeJsonRpcMessage,
} from "./json-rpc";

describe("parseJsonRpcMessage", () => {
  it("parses a request with params", () => {
    expect(
      parseJsonRpcMessage(
        '{"jsonrpc":"2.0","id":1,"method":"session/new","params":{"cwd":"/w"}}',
      ),
    ).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "session/new",
      params: { cwd: "/w" },
    });
  });

  it("parses a request without params", () => {
    expect(
      parseJsonRpcMessage('{"jsonrpc":"2.0","id":"a","method":"initialize"}'),
    ).toEqual({ jsonrpc: "2.0", id: "a", method: "initialize" });
  });

  it("parses a notification", () => {
    expect(
      parseJsonRpcMessage('{"jsonrpc":"2.0","method":"initialized"}'),
    ).toEqual({ jsonrpc: "2.0", method: "initialized" });
  });

  it("parses a success response", () => {
    expect(
      parseJsonRpcMessage('{"jsonrpc":"2.0","id":7,"result":{"ok":true}}'),
    ).toEqual({ jsonrpc: "2.0", id: 7, result: { ok: true } });
  });

  it("parses an error response with data", () => {
    expect(
      parseJsonRpcMessage(
        '{"jsonrpc":"2.0","id":7,"error":{"code":-32601,"message":"nope","data":{"m":"x"}}}',
      ),
    ).toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: { code: -32601, message: "nope", data: { m: "x" } },
    });
  });

  it.each([
    ["invalid JSON", "{not json}", "not valid JSON"],
    ["a JSON array", "[]", "must be a JSON object"],
    ["null", "null", "must be a JSON object"],
    ["a missing version", '{"id":1,"method":"m"}', '"jsonrpc"'],
    ["a wrong version", '{"jsonrpc":"1.0","id":1,"method":"m"}', '"jsonrpc"'],
    ["an empty method", '{"jsonrpc":"2.0","method":""}', "non-empty string"],
    [
      "a method with a result",
      '{"jsonrpc":"2.0","id":1,"method":"m","result":1}',
      "cannot carry result or error",
    ],
    [
      "a null request id",
      '{"jsonrpc":"2.0","id":null,"method":"m"}',
      "number or string",
    ],
    [
      "a boolean request id",
      '{"jsonrpc":"2.0","id":true,"method":"m"}',
      "number or string",
    ],
    [
      "neither method nor id",
      '{"jsonrpc":"2.0","result":1}',
      "needs a method or an id",
    ],
    [
      "both result and error",
      '{"jsonrpc":"2.0","id":1,"result":1,"error":{"code":1,"message":"m"}}',
      "exactly one of result or error",
    ],
    [
      "neither result nor error",
      '{"jsonrpc":"2.0","id":1}',
      "exactly one of result or error",
    ],
    [
      "a non-object error",
      '{"jsonrpc":"2.0","id":1,"error":"boom"}',
      "Error must be an object",
    ],
    [
      "a non-numeric error code",
      '{"jsonrpc":"2.0","id":1,"error":{"code":"-1","message":"m"}}',
      "Error code must be a number",
    ],
    [
      "a non-string error message",
      '{"jsonrpc":"2.0","id":1,"error":{"code":-1,"message":2}}',
      "Error message must be a string",
    ],
  ])("rejects %s", (_label, line, reason) => {
    expect(() => parseJsonRpcMessage(line)).toThrow(JsonRpcParseError);
    expect(() => parseJsonRpcMessage(line)).toThrow(reason);
  });
});

describe("serializeJsonRpcMessage", () => {
  it("round-trips through the parser", () => {
    const message = {
      jsonrpc: "2.0" as const,
      id: 3,
      method: "session/prompt",
      params: { sessionId: "s", prompt: "two\nlines" },
    };

    expect(parseJsonRpcMessage(serializeJsonRpcMessage(message))).toEqual(
      message,
    );
  });

  it("keeps each message on one line", () => {
    const serialized = serializeJsonRpcMessage({
      jsonrpc: "2.0",
      id: 1,
      result: "a\nb",
    });

    expect(serialized).not.toContain("\n");
  });
});

describe("createLineDecoder", () => {
  it("returns both messages when they arrive in one chunk", () => {
    const decoder = createLineDecoder();

    expect(
      decoder.push('{"jsonrpc":"2.0","id":1,"method":"a"}\n{"jsonrpc":"2.0","id":2,"method":"b"}\n'),
    ).toEqual([
      '{"jsonrpc":"2.0","id":1,"method":"a"}',
      '{"jsonrpc":"2.0","id":2,"method":"b"}',
    ]);
  });

  it("reassembles a message split at any byte offset", () => {
    const payload =
      '{"jsonrpc":"2.0","id":1,"method":"a"}\n{"jsonrpc":"2.0","method":"b"}\n';

    for (let split = 0; split <= payload.length; split += 1) {
      const decoder = createLineDecoder();
      const lines = [
        ...decoder.push(payload.slice(0, split)),
        ...decoder.push(payload.slice(split)),
      ];

      expect(lines).toEqual([
        '{"jsonrpc":"2.0","id":1,"method":"a"}',
        '{"jsonrpc":"2.0","method":"b"}',
      ]);
    }
  });

  it("tolerates CRLF line endings and blank lines", () => {
    const decoder = createLineDecoder();

    expect(
      decoder.push('\r\n{"jsonrpc":"2.0","method":"a"}\r\n  \r\n'),
    ).toEqual(['{"jsonrpc":"2.0","method":"a"}']);
  });

  it("holds a trailing partial line until its newline arrives", () => {
    const decoder = createLineDecoder();

    expect(decoder.push('{"jsonrpc":"2.0","id":1')).toEqual([]);
    expect(decoder.push(',"method":"a"}\n')).toEqual([
      '{"jsonrpc":"2.0","id":1,"method":"a"}',
    ]);
  });
});
