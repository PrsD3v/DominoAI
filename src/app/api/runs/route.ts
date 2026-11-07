import { connection } from "next/server";
import {
  handleRunRequest,
  readJsonObject,
  requireJsonContentType,
} from "../../../lib/runs/http";
import { getRunService } from "../../../lib/runs/runtime";
import type { RunService } from "../../../lib/runs/service";

export async function handleListRuns(service: RunService): Promise<Response> {
  return Response.json({ runs: await service.listRuns() });
}

export async function handleStartRun(
  request: Request,
  service: RunService,
): Promise<Response> {
  requireJsonContentType(request);
  const body = await readJsonObject(request);

  return Response.json(
    { run: await service.startRun(body) },
    { status: 201 },
  );
}

export async function GET(): Promise<Response> {
  return handleRunRequest(async () => {
    await connection();
    return handleListRuns(await getRunService());
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleRunRequest(async () => {
    return handleStartRun(request, await getRunService());
  });
}
