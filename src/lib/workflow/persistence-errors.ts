/** Raised when a workflow or project record cannot be created or updated. */
export class WorkflowRecordError extends Error {
  readonly operation: "create" | "update";
  readonly recordKind: string;
  readonly id: string;

  constructor(
    operation: "create" | "update",
    recordKind: string,
    id: string,
  ) {
    super(
      operation === "create"
        ? `A ${recordKind} with id "${id}" already exists`
        : `No ${recordKind} with id "${id}" exists`,
    );
    this.name = "WorkflowRecordError";
    this.operation = operation;
    this.recordKind = recordKind;
    this.id = id;
  }
}

/** Why a durable store could not complete an operation. */
export type WorkflowPersistenceErrorCode =
  | "schema"
  | "decode"
  | "reference"
  | "conflict"
  | "invalid";

/** Raised when a durable store cannot be opened or a stored record is unusable. */
export class WorkflowPersistenceError extends Error {
  readonly code: WorkflowPersistenceErrorCode;

  constructor(code: WorkflowPersistenceErrorCode, message: string) {
    super(message);
    this.name = "WorkflowPersistenceError";
    this.code = code;
  }
}
