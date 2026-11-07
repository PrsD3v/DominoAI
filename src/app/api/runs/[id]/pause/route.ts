import { handleRunRequest } from "../../../../../lib/runs/http";
import { getRunService } from "../../../../../lib/runs/runtime";
import type { RunService } from "../../../../../lib/runs/service";

export async function handlePauseRun(
  id: string,
  service: RunService,
): Promise<Response> {
  return Response.json({ run: await service.pauseRun(id) });
}

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function POST(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleRunRequest(async () => {
    const { id } = await context.params;
    return handlePauseRun(id, await getRunService());
  });
}
