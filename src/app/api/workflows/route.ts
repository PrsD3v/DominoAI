import { connection } from "next/server";
import { handleRunRequest } from "../../../lib/runs/http";
import { getRunService } from "../../../lib/runs/runtime";
import type { RunService } from "../../../lib/runs/service";

export async function handleGetWorkflows(
  service: RunService,
): Promise<Response> {
  return Response.json(await service.listWorkflows());
}

export async function GET(): Promise<Response> {
  return handleRunRequest(async () => {
    await connection();
    return handleGetWorkflows(await getRunService());
  });
}
