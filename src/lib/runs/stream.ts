import type { RunDetail, RunState } from "../../types/run-api";
import type { RunService } from "./service";

/** Poll interval for the SSE bridge. */
export const RUN_EVENT_POLL_MS = 750;
/** Comment interval that keeps an idle stream open. */
export const RUN_EVENT_HEARTBEAT_MS = 15_000;
/** Reconnect delay advertised to `EventSource`. */
export const RUN_EVENT_RETRY_MS = 2000;

type StreamService = Pick<
  RunService,
  "getRun" | "getState" | "listRuntimeEvents"
>;

export interface RunEventStreamOptions {
  readonly service: StreamService;
  readonly runId: string;
  readonly signal?: AbortSignal;
  readonly pollMs?: number;
  readonly heartbeatMs?: number;
  readonly now?: () => number;
}

export interface RunEventStream {
  readonly pollMs: number;
  start(): Promise<readonly string[]>;
  tick(): Promise<readonly string[]>;
}

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function fingerprint(state: RunState): string {
  return JSON.stringify({
    run: state.run,
    steps: state.steps,
    approvals: state.approvals,
    history: state.history,
  });
}

class RunEventStreamImpl implements RunEventStream {
  readonly pollMs: number;
  private lastEventCount = 0;
  private lastFingerprint = "";
  private lastHeartbeatAt = 0;

  constructor(private readonly options: RunEventStreamOptions) {
    this.pollMs = options.pollMs ?? RUN_EVENT_POLL_MS;
  }

  async start(): Promise<readonly string[]> {
    const detail: RunDetail = await this.options.service.getRun(
      this.options.runId,
    );

    this.lastEventCount = detail.events.length;
    this.lastFingerprint = fingerprint(detail);
    this.lastHeartbeatAt = this.options.now?.() ?? Date.now();

    return [`retry: ${RUN_EVENT_RETRY_MS}\n\n`, frame("snapshot", detail)];
  }

  async tick(): Promise<readonly string[]> {
    if (this.options.signal?.aborted === true) {
      return [];
    }

    const frames: string[] = [];
    const state = await this.options.service.getState(this.options.runId);
    const nextFingerprint = fingerprint(state);

    if (nextFingerprint !== this.lastFingerprint) {
      this.lastFingerprint = nextFingerprint;
      frames.push(frame("state", state));
    }

    const events = await this.options.service.listRuntimeEvents(
      this.options.runId,
      this.lastEventCount,
    );

    for (const event of events) {
      frames.push(frame("event", event));
    }

    this.lastEventCount += events.length;

    const now = this.options.now?.() ?? Date.now();

    if (
      now - this.lastHeartbeatAt >=
      (this.options.heartbeatMs ?? RUN_EVENT_HEARTBEAT_MS)
    ) {
      this.lastHeartbeatAt = now;
      frames.push(": ping\n\n");
    }

    return frames;
  }
}

/** Build a stateful SSE bridge that starts from a fresh snapshot. */
export function createRunEventStream(
  options: RunEventStreamOptions,
): RunEventStream {
  return new RunEventStreamImpl(options);
}

/** Resolve after `ms`, or immediately when the request signal aborts. */
export function abortableSleep(
  ms: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);

    signal.addEventListener("abort", finish, { once: true });
  });
}
