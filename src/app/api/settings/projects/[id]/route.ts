import { connection } from "next/server";
import {
  handleSettingsRequest,
  readJsonObject,
  requireJsonContentType,
} from "../../../../../lib/settings/http";
import { getSettingsService } from "../../../../../lib/settings/runtime";
import type { SettingsService } from "../../../../../lib/settings/service";

export async function handleGetProjectDefaultProfile(
  _request: Request,
  projectId: string,
  service: SettingsService,
): Promise<Response> {
  return Response.json(await service.getProjectDefaultProfile(projectId));
}

export async function handleUpdateProjectDefaultProfile(
  request: Request,
  projectId: string,
  service: SettingsService,
): Promise<Response> {
  requireJsonContentType(request);
  const body = await readJsonObject(request);
  return Response.json(
    await service.updateProjectDefaultProfile(projectId, body),
  );
}

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleSettingsRequest(async () => {
    await connection();
    const { id } = await context.params;
    return handleGetProjectDefaultProfile(request, id, getSettingsService());
  });
}

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleSettingsRequest(async () => {
    const { id } = await context.params;
    return handleUpdateProjectDefaultProfile(
      request,
      id,
      getSettingsService(),
    );
  });
}
