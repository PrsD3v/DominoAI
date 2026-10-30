import { connection } from "next/server";
import {
  handleSettingsRequest,
  readJsonObject,
  requireJsonContentType,
} from "../../../../../../lib/settings/http";
import { getSettingsService } from "../../../../../../lib/settings/runtime";
import type { SettingsService } from "../../../../../../lib/settings/service";

export async function handleGetCredentialStatus(
  _request: Request,
  id: string,
  service: SettingsService,
): Promise<Response> {
  return Response.json({ status: await service.getCredentialStatus(id) });
}

export async function handleSetCredential(
  request: Request,
  id: string,
  service: SettingsService,
): Promise<Response> {
  requireJsonContentType(request);
  const body = await readJsonObject(request);
  const status = await service.setCredential(id, body);
  return Response.json({ status });
}

export async function handleRemoveCredential(
  _request: Request,
  id: string,
  service: SettingsService,
): Promise<Response> {
  return Response.json({ status: await service.removeCredential(id) });
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
    return handleGetCredentialStatus(request, id, getSettingsService());
  });
}

export async function PUT(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleSettingsRequest(async () => {
    const { id } = await context.params;
    return handleSetCredential(request, id, getSettingsService());
  });
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleSettingsRequest(async () => {
    const { id } = await context.params;
    return handleRemoveCredential(request, id, getSettingsService());
  });
}
