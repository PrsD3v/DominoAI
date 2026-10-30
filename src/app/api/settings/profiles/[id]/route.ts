import {
  handleSettingsRequest,
  readJsonObject,
  requireJsonContentType,
} from "../../../../../lib/settings/http";
import { getSettingsService } from "../../../../../lib/settings/runtime";
import type { SettingsService } from "../../../../../lib/settings/service";

export async function handleUpdateProfile(
  request: Request,
  id: string,
  service: SettingsService,
): Promise<Response> {
  requireJsonContentType(request);
  const body = await readJsonObject(request);
  const profile = await service.updateProfile(id, body);
  return Response.json({ profile });
}

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleSettingsRequest(async () => {
    const { id } = await context.params;
    return handleUpdateProfile(request, id, getSettingsService());
  });
}
