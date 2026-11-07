import { connection } from "next/server";
import {
  handleRunRequest,
  readJsonObject,
  requireJsonContentType,
} from "../../../lib/runs/http";
import { getRunService } from "../../../lib/runs/runtime";
import type { RunService } from "../../../lib/runs/service";

export async function handleListProjects(
  service: RunService,
): Promise<Response> {
  return Response.json({ projects: await service.listProjects() });
}

export async function handleCreateProject(
  request: Request,
  service: RunService,
): Promise<Response> {
  requireJsonContentType(request);
  const body = await readJsonObject(request);

  return Response.json(
    { project: await service.registerProject(body) },
    { status: 201 },
  );
}

export async function GET(): Promise<Response> {
  return handleRunRequest(async () => {
    await connection();
    return handleListProjects(await getRunService());
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleRunRequest(async () => {
    return handleCreateProject(request, await getRunService());
  });
}
