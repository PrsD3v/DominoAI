import {
  parseSettingsFailure,
  type SettingsFailureCode,
} from "./screen";

export type SettingsRequestResult =
  | { readonly ok: true; readonly body: unknown }
  | {
      readonly ok: false;
      readonly code: SettingsFailureCode;
      readonly body: unknown;
    };

/** Fetch a settings endpoint and keep the parsed body for field-level errors. */
export async function requestSettingsJson(
  path: string,
  init?: RequestInit,
): Promise<SettingsRequestResult> {
  let response: Response;

  try {
    response = await fetch(path, { cache: "no-store", ...init });
  } catch {
    return { ok: false, code: "network", body: null };
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
      code: parseSettingsFailure(response.status, body),
      body,
    };
  }

  return { ok: true, body };
}
