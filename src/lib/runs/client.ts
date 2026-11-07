import { parseRunFailure, type RunFailureCode } from "./screen";

export type RunRequestResult =
  | { readonly ok: true; readonly status: number; readonly body: unknown }
  | {
      readonly ok: false;
      readonly status: number;
      readonly code: RunFailureCode;
      readonly body: unknown;
    };

/**
 * Fetch a run-service endpoint and keep the parsed body for field errors.
 * Network failures become the typed `network` code; malformed bodies stay null.
 */
export async function requestRunJson(
  path: string,
  init?: RequestInit,
): Promise<RunRequestResult> {
  let response: Response;

  try {
    response = await fetch(path, { cache: "no-store", ...init });
  } catch {
    return { ok: false, status: 0, code: "network", body: null };
  }

  let body: unknown = null;

  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      code: parseRunFailure(response.status, body),
      body,
    };
  }

  return { ok: true, status: response.status, body };
}

/** Send a JSON mutation through the run-service client wrapper. */
export function postRunJson(
  path: string,
  payload: unknown,
): Promise<RunRequestResult> {
  return requestRunJson(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** Send a JSON patch through the run-service client wrapper. */
export function patchRunJson(
  path: string,
  payload: unknown,
): Promise<RunRequestResult> {
  return requestRunJson(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}
