import { connection } from "next/server";
import { handleRunRequest } from "../../../../lib/runs/http";
import { getRunService } from "../../../../lib/runs/runtime";
import type { RunService } from "../../../../lib/runs/service";

export async function handleGetRun(
  id: string,
  service: RunService,
): Promise<Response> {
  return Response.json({ run: await service.getRun(id) });
}

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleRunRequest(async () => {
    await connection();
    const { id } = await context.params;
    return handleGetRun(id, await getRunService());
  });
}
