import { describe, expect, it } from "vitest";
import type { RunDetail } from "../../types/run-api";
import type { RuntimeEventRecord } from "../../types/workflow";
import { SAMPLE_DETAIL } from "./test-support";
import {
  abortableSleep,
  createRunEventStream,
  RUN_EVENT_HEARTBEAT_MS,
  RUN_EVENT_POLL_MS,
  RUN_EVENT_RETRY_MS,
} from "./stream";

function eventRecord(id: string, text: string): RuntimeEventRecord {
  return {
    id,
    runId: "run-1",
    stepRunId: "step-run-1",
    event: { type: "assistant_text_delta", text },
    recordedAt: "2026-11-07T00:00:01.000Z",
  };
}

function streamState(initial: RunDetail = SAMPLE_DETAIL) {
  let detail = initial;
  const events: RuntimeEventRecord[] = [...initial.events];

  return {
    service: {
      async getRun(): Promise<RunDetail> {
        return { ...detail, events: [...events] };
      },
      async getState() {
        return {
          run: detail.run,
          steps: detail.steps,
          approvals: detail.approvals,
          history: detail.history,
        };
      },
      async listRuntimeEvents(
        _runId: string,
        fromIndex: number,
      ): Promise<readonly RuntimeEventRecord[]> {
        return events.slice(fromIndex);
      },
    },
    setRun(run: RunDetail["run"]): void {
      detail = { ...detail, run };
    },
    addEvent(record: RuntimeEventRecord): void {
      events.push(record);
    },
  };
}

function dataOf(frame: string): unknown {
  const line = frame
    .split("\n")
    .find((entry) => entry.startsWith("data: "));

  return line === undefined ? null : JSON.parse(line.slice("data: ".length));
}

describe("createRunEventStream", () => {
  it("starts with a retry hint and a full snapshot", async () => {
    const state = streamState();
    const stream = createRunEventStream({
      service: state.service,
      runId: "run-1",
    });

    const frames = await stream.start();

    expect(frames[0]).toBe(`retry: ${RUN_EVENT_RETRY_MS}\n\n`);
    expect(frames[1]).toContain("event: snapshot");
    expect(dataOf(frames[1] ?? "")).toEqual(SAMPLE_DETAIL);
    expect(stream.pollMs).toBe(RUN_EVENT_POLL_MS);
  });

  it("emits one state frame when state changes", async () => {
    const state = streamState();
    const stream = createRunEventStream({
      service: state.service,
      runId: "run-1",
    });

    await stream.start();
    expect(await stream.tick()).toEqual([]);

    state.setRun({ ...SAMPLE_DETAIL.run, status: "cancelled" });

    const frames = await stream.tick();

    expect(frames).toHaveLength(1);
    expect(frames[0]).toContain("event: state");
    expect(dataOf(frames[0] ?? "")).toMatchObject({
      run: { status: "cancelled" },
      steps: [],
      approvals: [],
      history: [],
    });
    expect(await stream.tick()).toEqual([]);
  });

  it("emits each new runtime event once, after the state frame", async () => {
    const state = streamState();
    const stream = createRunEventStream({
      service: state.service,
      runId: "run-1",
    });

    await stream.start();

    state.setRun({ ...SAMPLE_DETAIL.run, status: "running" });
    state.addEvent(eventRecord("event-1", "hello"));
    state.addEvent(eventRecord("event-2", " world"));

    const frames = await stream.tick();

    expect(frames).toHaveLength(3);
    expect(frames[0]).toContain("event: state");
    expect(frames[1]).toContain("event: event");
    expect(frames[2]).toContain("event: event");
    expect(dataOf(frames[1] ?? "")).toMatchObject({
      id: "event-1",
      event: { type: "assistant_text_delta", text: "hello" },
    });
    expect(dataOf(frames[2] ?? "")).toMatchObject({ id: "event-2" });
    expect(await stream.tick()).toEqual([]);
  });

  it("redacts secret-shaped values in every frame", async () => {
    const state = streamState({
      ...SAMPLE_DETAIL,
      run: { ...SAMPLE_DETAIL.run, error: "api_key=abcd1234" },
      events: [eventRecord("event-1", "sk-test-secret-value")],
    });
    const stream = createRunEventStream({
      service: state.service,
      runId: "run-1",
    });

    const frames = await stream.start();
    const joined = frames.join("\n");

    expect(joined).not.toContain("sk-test-secret-value");
    expect(joined).not.toContain("abcd1234");
    expect(joined).toContain("[redacted]");
  });

  it("starts a fresh snapshot on every connection", async () => {
    const state = streamState();

    const first = createRunEventStream({
      service: state.service,
      runId: "run-1",
    });
    await first.start();
    state.setRun({ ...SAMPLE_DETAIL.run, status: "completed" });
    await first.tick();

    const second = createRunEventStream({
      service: state.service,
      runId: "run-1",
    });
    const frames = await second.start();

    expect(frames[1]).toContain("event: snapshot");
    expect(dataOf(frames[1] ?? "")).toMatchObject({
      run: { status: "completed" },
    });
  });

  it("emits a heartbeat once the configured interval passes", async () => {
    let now = 0;
    const stream = createRunEventStream({
      service: streamState().service,
      runId: "run-1",
      heartbeatMs: 100,
      now: () => now,
    });

    await stream.start();
    now = 99;
    expect(await stream.tick()).toEqual([]);
    now = 100;
    expect(await stream.tick()).toEqual([": ping\n\n"]);
    expect(RUN_EVENT_HEARTBEAT_MS).toBe(15_000);
  });

  it("returns no frames after the signal is aborted", async () => {
    const controller = new AbortController();
    const stream = createRunEventStream({
      service: streamState().service,
      runId: "run-1",
      signal: controller.signal,
    });

    await stream.start();
    controller.abort();

    expect(await stream.tick()).toEqual([]);
  });
});

describe("abortableSleep", () => {
  it("resolves immediately for an aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(abortableSleep(10_000, controller.signal)).resolves.toBe(
      undefined,
    );
  });

  it("resolves early when the signal aborts", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const sleep = abortableSleep(10_000, controller.signal);

    controller.abort();
    await sleep;

    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
