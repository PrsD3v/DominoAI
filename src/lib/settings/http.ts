import {
  SettingsError,
  type SettingsErrorCode,
  type SettingsErrorField,
} from "./service";

const STATUS_BY_CODE: Record<SettingsErrorCode, number> = {
  invalid_request: 400,
  invalid_json: 400,
  unsupported_media_type: 415,
  invalid_secret: 400,
  profile_not_found: 404,
  provider_unknown: 400,
  model_unknown: 400,
  api_key_env_unknown: 400,
  catalog_unavailable: 503,
  credential_path_rejected: 409,
  credential_file_invalid: 409,
  credential_conflict: 409,
  credential_locked: 503,
  credential_unavailable: 500,
  persistence_error: 500,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Map a typed settings failure to a status and a non-secret JSON body. */
export function settingsErrorResponse(error: SettingsError): Response {
  const body: {
    error: {
      code: SettingsErrorCode;
      message: string;
      fields?: readonly SettingsErrorField[];
    };
  } = {
    error: { code: error.code, message: error.message },
  };

  if (error.fields !== undefined) {
    body.error.fields = error.fields;
  }

  return Response.json(body, { status: STATUS_BY_CODE[error.code] });
}

/**
 * Turn a typed settings failure into a response. Unexpected errors are
 * rethrown so the runtime's own error path handles them.
 */
export async function handleSettingsRequest(
  handler: () => Promise<Response>,
): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof SettingsError) {
      return settingsErrorResponse(error);
    }

    throw error;
  }
}

/** Read a JSON object body, rejecting unparseable or non-object input. */
export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown>> {
  let value: unknown;

  try {
    value = await request.json();
  } catch {
    throw new SettingsError("invalid_json");
  }

  if (!isRecord(value)) {
    throw new SettingsError("invalid_json");
  }

  return value;
}

/** Require a JSON content type on requests that carry a body. */
export function requireJsonContentType(request: Request): void {
  const contentType = request.headers.get("content-type");

  if (
    contentType === null ||
    !contentType.toLowerCase().startsWith("application/json")
  ) {
    throw new SettingsError("unsupported_media_type");
  }
}
