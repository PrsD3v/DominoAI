import {
  handleRunRequest,
  readJsonObject,
  requireJsonContentType,
} from "../../../../../../lib/runs/http";
import { getRunService } from "../../../../../../lib/runs/runtime";
import type { RunService } from "../../../../../../lib/runs/service";

export async function handleAnswerApproval(
  id: string,
  approvalId: string,
  request: Request,
  service: RunService,
): Promise<Response> {
  requireJsonContentType(request);
  const body = await readJsonObject(request);

  return Response.json({
    run: await service.answerApproval(id, approvalId, body),
  });
}

interface RouteContext {
  readonly params: Promise<{
    readonly id: string;
    readonly approvalId: string;
  }>;
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleRunRequest(async () => {
    const { id, approvalId } = await context.params;
    return handleAnswerApproval(id, approvalId, request, await getRunService());
  });
}
