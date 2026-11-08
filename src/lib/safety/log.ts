import { redactText } from "./redaction";

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Write one redacted error line for an unexpected server failure. Typed service
 * errors are handled by their own response path and never reach this helper.
 */
export function logServerError(scope: string, error: unknown): void {
  console.error(`[${scope}] ${redactText(describeError(error))}`);
}
