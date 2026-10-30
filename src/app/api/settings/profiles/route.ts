import { connection } from "next/server";
import {
  handleSettingsRequest,
  readJsonObject,
  requireJsonContentType,
} from "../../../../lib/settings/http";
import { getSettingsService } from "../../../../lib/settings/runtime";
import type { SettingsService } from "../../../../lib/settings/service";

export async function handleListProfiles(
  _request: Request,
  service: SettingsService,
): Promise<Response> {
  return Response.json({ profiles: await service.listProfiles() });
}

export async function handleCreateProfile(
  request: Request,
  service: SettingsService,
): Promise<Response> {
  requireJsonContentType(request);
  const body = await readJsonObject(request);
  const profile = await service.createProfile(body);
  return Response.json({ profile }, { status: 201 });
}

export async function GET(request: Request): Promise<Response> {
  return handleSettingsRequest(async () => {
    await connection();
    return handleListProfiles(request, getSettingsService());
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleSettingsRequest(() =>
    handleCreateProfile(request, getSettingsService()),
  );
}
