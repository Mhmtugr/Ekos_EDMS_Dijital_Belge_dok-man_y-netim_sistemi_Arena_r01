// Belge soru-cevap API'si (RAG). Oturum zorunlu; yetki SQL içinde uygulanır. AI kapalıysa yalnız kaynak pasajlar döner.
import { createAiProvider, readAiGate } from "@ekos/adapters";
import { askDocuments } from "@ekos/db";
import { toApiError } from "@ekos/core";
import { db } from "@/lib/server/runtime";
import { actorFromRequest } from "@/lib/server/session";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { errorResponse, newCorrelationId, sameOrigin } from "@/lib/server/http";

const USER_POLICY = { max: 20, windowMs: 60 * 1000 } as const;

export async function POST(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  try {
    if (!sameOrigin(req)) return Response.json(toApiError("CSRF_REJECTED", cid), { status: 403 });
    const actor = await actorFromRequest(req);
    if (!actor) return Response.json(toApiError("UNAUTHENTICATED", cid), { status: 401 });
    if (req.headers.get("content-type")?.startsWith("application/json") !== true) {
      return Response.json(toApiError("VALIDATION_FAILED", cid), { status: 400 });
    }
    if (!consumeRateLimit(`ask:${actor.userId}`, USER_POLICY)) {
      return Response.json(toApiError("RATE_LIMITED", cid), { status: 429, headers: { "Retry-After": "60" } });
    }
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json(toApiError("VALIDATION_FAILED", cid), { status: 400 });
    }
    const question = typeof body === "object" && body !== null && "question" in body && typeof body.question === "string" ? body.question.trim() : "";
    if (question.length === 0 || question.length > 500) return Response.json(toApiError("VALIDATION_FAILED", cid), { status: 400 });

    const state = createAiProvider(process.env);
    const gate = readAiGate(process.env);
    const result = await askDocuments(db(), {
      actor,
      question,
      correlationId: cid,
      model: state.status === "CONFIGURED" ? state.provider : null,
      approvedTypeCodes: gate.approvedTypeCodes,
    });
    return Response.json({ ...result, correlationId: cid });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
