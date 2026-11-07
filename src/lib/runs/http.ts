import type { RunErrorBody, RunErrorCode } from "../../types/run-api";
import { RunServiceError } from "./service";

const STATUS_BY_CODE: Record<RunErrorCode, number> = {
  invalid_request: 400,
  invalid_json: 400,
  unsupported_media_type: 415,
  project_not_found: 404,
  workflow_version_not_found: 404,
  skill_version_not_found: 404,
  workspace_root_invalid: 400,
  workspace_root_registered: 409,
  runtime_profile_not_found: 409,
  runtime_profile_required: 409,
  runtime_profile_invalid: 409,
  credential_missing: 409,
  workflow_version_not_selected: 409,
  workflow_version_invalid: 409,
  skill_version_missing: 409,
  run_not_found: 404,
  run_busy: 409,
  run_state_conflict: 409,
  approval_not_found: 404,
  approval_already_resolved: 409,
  persistence_error: 500,
  runtime_unavailable: 503,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Map a typed run failure to a status and a non-secret JSON body. */
export function runErrorResponse(error: RunServiceError): Response {
  const body: RunErrorBody = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.fields === undefined ? {} : { fields: error.fields }),
    },
  };

  return Response.json(body, { status: STATUS_BY_CODE[error.code] });
}

/**
 * Turn a typed run failure into a response. Unexpected errors are rethrown so
 * the runtime's own error path handles them.
 */
export async function handleRunRequest(
  handler: () => Promise<Response>,
): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof RunServiceError) {
      return runErrorResponse(error);
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
    throw new RunServiceError("invalid_json");
  }

  if (!isRecord(value)) {
    throw new RunServiceError("invalid_json");
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
    throw new RunServiceError("unsupported_media_type");
  }
}
