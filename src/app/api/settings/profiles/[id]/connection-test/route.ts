import { handleSettingsRequest } from "../../../../../../lib/settings/http";
import { getSettingsService } from "../../../../../../lib/settings/runtime";
import type { SettingsService } from "../../../../../../lib/settings/service";

export async function handleTestConnection(
  _request: Request,
  id: string,
  service: SettingsService,
): Promise<Response> {
  return Response.json({ result: await service.testConnection(id) });
}

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleSettingsRequest(async () => {
    const { id } = await context.params;
    return handleTestConnection(request, id, getSettingsService());
  });
}
