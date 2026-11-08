import type { RuntimeEvent } from "../../types/runtime";

/** The text that replaces a secret-shaped value. */
export const REDACTED = "[redacted]";

const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const SK_KEY = /\bsk-(?:ant-)?[A-Za-z0-9_-]{8,}\b/g;
const GITHUB_KEY = /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g;
const SLACK_KEY = /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g;
const ASSIGNMENT =
  /\b(api[_-]?key|apikey|access[_-]?token|token|secret|password|authorization)(["']?\s*[:=]\s*)(["']?)(?!Bearer\b)([^\s"',;]+)\3/gi;

/**
 * Mask secret-shaped values while leaving keys, prose, paths, and code intact.
 * The patterns are intentionally bounded: this is a safety net, not a
 * data-loss-prevention system.
 */
export function redactText(text: string): string {
  return text
    .replace(BEARER, `Bearer ${REDACTED}`)
    .replace(SK_KEY, REDACTED)
    .replace(GITHUB_KEY, REDACTED)
    .replace(SLACK_KEY, REDACTED)
    .replace(
      ASSIGNMENT,
      (_match, key: string, separator: string, quote: string) =>
        `${key}${separator}${quote}${REDACTED}${quote}`,
    );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Deep-copy plain JSON data and redact every string leaf. */
export function redactValue<T>(value: T): T {
  if (typeof value === "string") {
    return redactText(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry)) as T;
  }

  if (isPlainRecord(value)) {
    const result: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(value)) {
      result[key] = redactValue(entry);
    }

    return result as T;
  }

  return value;
}

/** Redact a normalized runtime event without changing its record shape. */
export function redactRuntimeEvent(event: RuntimeEvent): RuntimeEvent {
  return redactValue(event);
}
