import { describe, expect, it } from "vitest";
import {
  AcpProtocolError,
  AcpUnsupportedProtocolError,
  AcpUnsupportedStopReasonError,
  extractAgentTextChunk,
  parseInitializeResult,
  parsePromptResult,
  parseSessionNewResult,
} from "./protocol";

const OBSERVED_INITIALIZE_RESULT = {
  protocolVersion: 1,
  agentCapabilities: {
    loadSession: true,
    sessionCapabilities: {
      list: {},
      resume: {},
      close: {},
      delete: {},
      additionalDirectories: {},
    },
    promptCapabilities: {
      image: true,
      audio: false,
      embeddedContext: true,
    },
    mcpCapabilities: { http: true, sse: false },
    _meta: {
      "reasonix.io": {
        sessionSteer: { method: "_reasonix.io/session/steer" },
      },
    },
  },
  agentInfo: { name: "reasonix", version: "v2.54.0" },
  authMethods: [{ id: "reasonix-setup", type: "terminal", args: ["setup"] }],
};

const NORMALIZED = {
  protocolVersion: 1,
  agent: { name: "reasonix", version: "v2.54.0" },
  loadSession: true,
  sessions: { list: true, resume: true, close: true },
};

describe("parseInitializeResult", () => {
  it("normalizes the observed Reasonix response", () => {
    expect(parseInitializeResult(OBSERVED_INITIALIZE_RESULT)).toEqual(NORMALIZED);
  });

  it("normalizes a missing agentInfo to null", () => {
    const { agentInfo: _agentInfo, ...result } = OBSERVED_INITIALIZE_RESULT;

    expect(parseInitializeResult(result).agent).toBeNull();
  });

  it("normalizes incomplete or invalid agentInfo to null", () => {
    for (const agentInfo of [
      {},
      { name: "reasonix" },
      { version: "v2.54.0" },
      { name: "", version: "v2.54.0" },
      { name: "reasonix", version: 1 },
      "reasonix",
      null,
      [],
    ]) {
      expect(
        parseInitializeResult({ ...OBSERVED_INITIALIZE_RESULT, agentInfo }).agent,
      ).toBeNull();
    }
  });

  it("treats absent capability blocks as unsupported", () => {
    expect(parseInitializeResult({ protocolVersion: 1 })).toEqual({
      protocolVersion: 1,
      agent: null,
      loadSession: false,
      sessions: { list: false, resume: false, close: false },
    });
  });

  it("accepts true and object capability advertisements", () => {
    const capabilities = parseInitializeResult({
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: { list: true, resume: {}, close: true },
      },
    });

    expect(capabilities.loadSession).toBe(true);
    expect(capabilities.sessions).toEqual({
      list: true,
      resume: true,
      close: true,
    });
  });

  it("treats false, null, and invalid session capabilities as unsupported", () => {
    for (const advertisement of [false, null, "yes", 0, []]) {
      const capabilities = parseInitializeResult({
        protocolVersion: 1,
        agentCapabilities: {
          sessionCapabilities: { close: advertisement },
        },
      });

      expect(capabilities.sessions.close).toBe(false);
    }
  });

  it("ignores unknown capabilities and extra fields", () => {
    const capabilities = parseInitializeResult({
      ...OBSERVED_INITIALIZE_RESULT,
      extraField: "ignored",
      agentCapabilities: {
        ...OBSERVED_INITIALIZE_RESULT.agentCapabilities,
        unknownCapability: { nested: true },
        sessionCapabilities: {
          ...OBSERVED_INITIALIZE_RESULT.agentCapabilities.sessionCapabilities,
          teleport: {},
        },
      },
    });

    expect(capabilities).toEqual(NORMALIZED);
  });

  it("rejects a non-object result", () => {
    for (const value of [null, [], "initialize", 1]) {
      expect(() => parseInitializeResult(value)).toThrow(AcpProtocolError);
    }
  });

  it("rejects a missing or non-numeric protocolVersion", () => {
    for (const protocolVersion of [undefined, "1", null, Number.NaN]) {
      expect(() => parseInitializeResult({ protocolVersion })).toThrow(
        AcpProtocolError,
      );
    }
  });

  it("reports an unsupported protocol version with both versions", () => {
    const error = (() => {
      try {
        parseInitializeResult({ protocolVersion: 2 });
        return null;
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(AcpUnsupportedProtocolError);
    expect(error).toMatchObject({
      name: "AcpUnsupportedProtocolError",
      reportedVersion: 2,
      supportedVersion: 1,
    });
  });
});

describe("parseSessionNewResult", () => {
  it("returns the reported session id", () => {
    expect(parseSessionNewResult({ sessionId: "session-1" })).toBe("session-1");
  });

  it("ignores extra fields", () => {
    expect(
      parseSessionNewResult({ sessionId: "session-1", modes: [], extra: true }),
    ).toBe("session-1");
  });

  it("rejects a non-object result", () => {
    for (const value of [null, [], "session-1", 1]) {
      expect(() => parseSessionNewResult(value)).toThrow(AcpProtocolError);
    }
  });

  it("rejects a missing, empty, or non-string session id", () => {
    for (const sessionId of [undefined, "", 42, null]) {
      expect(() => parseSessionNewResult({ sessionId })).toThrow(
        AcpProtocolError,
      );
    }
  });
});

describe("parsePromptResult", () => {
  it("maps end_turn to completed", () => {
    expect(parsePromptResult({ stopReason: "end_turn" })).toBe("completed");
  });

  it("maps cancelled to cancelled", () => {
    expect(parsePromptResult({ stopReason: "cancelled" })).toBe("cancelled");
  });

  it("ignores extra result fields", () => {
    expect(
      parsePromptResult({ stopReason: "end_turn", usage: { input: 1 } }),
    ).toBe("completed");
  });

  it("rejects a missing stop reason and records it", () => {
    const error = (() => {
      try {
        parsePromptResult({});
        return null;
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(AcpUnsupportedStopReasonError);
    expect(error).toBeInstanceOf(AcpProtocolError);
    expect(error).toMatchObject({
      name: "AcpUnsupportedStopReasonError",
      reportedStopReason: undefined,
    });
  });

  it("rejects an unproven stop reason and keeps the reported value", () => {
    const error = (() => {
      try {
        parsePromptResult({ stopReason: "max_tokens" });
        return null;
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(AcpUnsupportedStopReasonError);
    expect(error).toMatchObject({ reportedStopReason: "max_tokens" });
  });

  it("rejects a non-string stop reason", () => {
    for (const stopReason of [null, 1, true, {}, []]) {
      expect(() => parsePromptResult({ stopReason })).toThrow(
        AcpUnsupportedStopReasonError,
      );
    }
  });

  it("rejects a non-object result", () => {
    for (const value of [null, [], "end_turn", 1]) {
      expect(() => parsePromptResult(value)).toThrow(
        AcpUnsupportedStopReasonError,
      );
    }
  });
});

describe("extractAgentTextChunk", () => {
  const textChunk = (text: string, sessionId = "session-1") => ({
    sessionId,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text },
    },
  });

  it("returns the text for this session's text chunk", () => {
    expect(extractAgentTextChunk("session-1", textChunk("hello"))).toBe("hello");
  });

  it("returns an empty string for an empty text chunk", () => {
    expect(extractAgentTextChunk("session-1", textChunk(""))).toBe("");
  });

  it("ignores another session", () => {
    expect(
      extractAgentTextChunk("session-1", textChunk("hello", "session-2")),
    ).toBeNull();
  });

  it("ignores another update kind", () => {
    expect(
      extractAgentTextChunk("session-1", {
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "thinking" },
        },
      }),
    ).toBeNull();
  });

  it("ignores content without text", () => {
    for (const content of [
      undefined,
      null,
      "hello",
      {},
      { type: "text" },
      { type: "text", text: 1 },
    ]) {
      expect(
        extractAgentTextChunk("session-1", {
          sessionId: "session-1",
          update: { sessionUpdate: "agent_message_chunk", content },
        }),
      ).toBeNull();
    }
  });

  it("ignores malformed params", () => {
    for (const params of [null, undefined, [], "session-1", 1, {}]) {
      expect(extractAgentTextChunk("session-1", params)).toBeNull();
    }
  });
});
