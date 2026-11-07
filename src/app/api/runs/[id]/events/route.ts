import { connection } from "next/server";
import { handleRunRequest } from "../../../../../lib/runs/http";
import { getRunService } from "../../../../../lib/runs/runtime";
import type { RunService } from "../../../../../lib/runs/service";
import {
  abortableSleep,
  createRunEventStream,
} from "../../../../../lib/runs/stream";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export async function handleRunEvents(
  request: Request,
  id: string,
  service: RunService,
): Promise<Response> {
  const stream = createRunEventStream({
    service,
    runId: id,
    signal: request.signal,
  });
  // Resolve the first snapshot before returning so a missing run is a JSON 404.
  const initial = await stream.start();
  const encoder = new TextEncoder();
  let closed = false;

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (frames: readonly string[]): void => {
        if (closed) {
          return;
        }

        for (const frame of frames) {
          controller.enqueue(encoder.encode(frame));
        }
      };

      try {
        enqueue(initial);

        while (!closed && !request.signal.aborted) {
          await abortableSleep(stream.pollMs, request.signal);

          if (closed || request.signal.aborted) {
            break;
          }

          enqueue(await stream.tick());
        }
      } catch {
        // A read failure ends this connection. A reconnect starts a new snapshot.
      } finally {
        closed = true;

        try {
          controller.close();
        } catch {
          // The controller may already be closed after a client disconnect.
        }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(body, { headers: SSE_HEADERS });
}

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleRunRequest(async () => {
    await connection();
    const { id } = await context.params;
    return handleRunEvents(request, id, await getRunService());
  });
}
