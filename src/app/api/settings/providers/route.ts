import { connection } from "next/server";
import {
  handleSettingsRequest,
} from "../../../../lib/settings/http";
import { getSettingsService } from "../../../../lib/settings/runtime";
import type { SettingsService } from "../../../../lib/settings/service";

export async function handleGetProviders(
  _request: Request,
  service: SettingsService,
): Promise<Response> {
  const catalog = await service.loadCatalog();
  return Response.json({ catalog });
}

export async function GET(request: Request): Promise<Response> {
  return handleSettingsRequest(async () => {
    await connection();
    return handleGetProviders(request, getSettingsService());
  });
}
