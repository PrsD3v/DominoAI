import { describe, expect, it } from "vitest";
import {
  REDACTED,
  redactRuntimeEvent,
  redactText,
  redactValue,
} from "./redaction";

describe("redactText", () => {
  it("masks OpenAI-style keys", () => {
    expect(redactText("key sk-test-secret-value here")).toBe(
      `key ${REDACTED} here`,
    );
    expect(redactText("sk-ant-api03-abcdefgh")).toBe(REDACTED);
  });

  it("masks GitHub and Slack tokens", () => {
    expect(redactText("ghp_abcdefghijklmnopqrstuvwxyz0123456789")).toBe(
      REDACTED,
    );
    expect(redactText("xoxb-1234567890-abcdefghij")).toBe(REDACTED);
  });

  it("masks bearer tokens", () => {
    expect(redactText("Authorization: Bearer abcdef123456")).toBe(
      `Authorization: Bearer ${REDACTED}`,
    );
  });

  it("masks unquoted assignments", () => {
    expect(redactText("api_key=abcd1234")).toBe(`api_key=${REDACTED}`);
    expect(redactText("password: hunter2")).toBe(`password: ${REDACTED}`);
  });

  it("masks quoted and JSON assignments without breaking the syntax", () => {
    expect(redactText(`token="abc123"`)).toBe(`token="${REDACTED}"`);
    expect(redactText(`{"password":"hunter2"}`)).toBe(
      `{"password":"${REDACTED}"}`,
    );
  });

  it("leaves ordinary words, names, paths, and code unchanged", () => {
    const text =
      'The token field is optional. secret name: env. api_key_env=OPENAI_API_KEY. src/secret/token.ts says "Bearer" alone.';
    expect(redactText(text)).toBe(text);
  });

  it("is idempotent", () => {
    const once = redactText("api_key=abcd1234 sk-live-abcdefgh");
    expect(redactText(once)).toBe(once);
  });
});

describe("redactValue", () => {
  it("redacts strings in nested arrays and objects", () => {
    expect(
      redactValue({
        run: { error: "failed with sk-test-secret-value" },
        steps: [{ resultText: "token=abc123" }],
        count: 2,
        done: true,
        missing: null,
      }),
    ).toEqual({
      run: { error: `failed with ${REDACTED}` },
      steps: [{ resultText: `token=${REDACTED}` }],
      count: 2,
      done: true,
      missing: null,
    });
  });

  it("does not mutate its input", () => {
    const input = { text: "sk-test-secret-value" };
    const output = redactValue(input);

    expect(input.text).toBe("sk-test-secret-value");
    expect(output).not.toBe(input);
  });

  it("preserves the runtime event type", () => {
    expect(
      redactRuntimeEvent({
        type: "assistant_text_delta",
        text: "use sk-test-secret-value",
      }),
    ).toEqual({
      type: "assistant_text_delta",
      text: `use ${REDACTED}`,
    });
  });
});
