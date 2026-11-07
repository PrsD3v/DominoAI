"use client";

import { useEffect, useRef, useState } from "react";
import { requestRunJson } from "@/lib/runs/client";
import {
  apiRunPath,
  appendRunEvents,
  isTerminalRunStatus,
  mergeRunState,
  narrowRunResponse,
  parseRunStreamFrame,
} from "@/lib/runs/screen";
import type { RunDetail } from "@/types/run-api";
import type { RuntimeEventRecord } from "@/types/workflow";

const EVENT_FLUSH_MS = 100;

export type RunStreamStatus = "connecting" | "live" | "reconnecting" | "ended";

export interface RunStreamState {
  readonly detail: RunDetail;
  readonly status: RunStreamStatus;
  readonly reload: () => void;
  readonly replaceDetail: (detail: RunDetail) => void;
}

function eventData(event: Event): string {
  return (event as MessageEvent<string>).data;
}

/**
 * Own the run detail while one SSE connection is open. A reload refetches detail
 * and reopens the stream; every reconnect starts from a fresh snapshot.
 */
export function useRunStream(
  runId: string,
  initialDetail: RunDetail,
): RunStreamState {
  const [detail, setDetail] = useState(initialDetail);
  const [status, setStatus] = useState<RunStreamStatus>(() =>
    isTerminalRunStatus(initialDetail.run.status) ? "ended" : "connecting",
  );
  const [reloadKey, setReloadKey] = useState(0);
  const detailRef = useRef(detail);
  const sourceRef = useRef<EventSource | null>(null);
  const pendingEventsRef = useRef<RuntimeEventRecord[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearPendingEvents() {
    pendingEventsRef.current = [];

    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }

  useEffect(() => {
    detailRef.current = detail;
  }, [detail]);

  useEffect(() => {
    let cancelled = false;

    const apply = (next: RunDetail) => {
      detailRef.current = next;
      setDetail(next);

      if (isTerminalRunStatus(next.run.status)) {
        sourceRef.current?.close();
        setStatus("ended");
      }
    };

    const flushPending = () => {
      flushTimerRef.current = null;
      const pending = pendingEventsRef.current;

      if (pending.length === 0) {
        return;
      }

      pendingEventsRef.current = [];
      apply(appendRunEvents(detailRef.current, pending));
    };

    const enqueueEvent = (record: RuntimeEventRecord) => {
      pendingEventsRef.current.push(record);

      if (flushTimerRef.current === null) {
        flushTimerRef.current = setTimeout(flushPending, EVENT_FLUSH_MS);
      }
    };

    async function start() {
      if (reloadKey > 0) {
        const result = await requestRunJson(apiRunPath(runId));

        if (cancelled) {
          return;
        }

        if (result.ok) {
          const next = narrowRunResponse(result.body);

          if (next === null) {
            setStatus("reconnecting");
          } else {
            apply(next);
          }
        } else {
          setStatus("reconnecting");
        }
      }

      if (cancelled) {
        return;
      }

      if (isTerminalRunStatus(detailRef.current.run.status)) {
        setStatus("ended");
        return;
      }

      const source = new EventSource(
        `${apiRunPath(runId)}/events`,
      );
      sourceRef.current = source;

      source.addEventListener("open", () => {
        if (!cancelled) {
          setStatus("live");
        }
      });

      source.addEventListener("error", () => {
        if (!cancelled) {
          setStatus("reconnecting");
        }
      });

      source.addEventListener("snapshot", (event) => {
        if (cancelled) {
          return;
        }

        const frame = parseRunStreamFrame("snapshot", eventData(event));

        if (frame.kind === "snapshot") {
          clearPendingEvents();
          apply(frame.detail);
        }
      });

      source.addEventListener("state", (event) => {
        if (cancelled) {
          return;
        }

        const frame = parseRunStreamFrame("state", eventData(event));

        if (frame.kind === "state") {
          flushPending();
          apply(mergeRunState(detailRef.current, frame.state));
        }
      });

      source.addEventListener("event", (event) => {
        if (cancelled) {
          return;
        }

        const frame = parseRunStreamFrame("event", eventData(event));

        if (frame.kind === "event") {
          enqueueEvent(frame.record);
        }
      });
    }

    void start();

    return () => {
      cancelled = true;
      clearPendingEvents();
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, [runId, reloadKey]);

  function replaceDetail(next: RunDetail) {
    clearPendingEvents();
    detailRef.current = next;
    setDetail(next);

    if (isTerminalRunStatus(next.run.status)) {
      sourceRef.current?.close();
      setStatus("ended");
    }
  }

  return {
    detail,
    status,
    reload: () => {
      setStatus("connecting");
      setReloadKey((current) => current + 1);
    },
    replaceDetail,
  };
}
