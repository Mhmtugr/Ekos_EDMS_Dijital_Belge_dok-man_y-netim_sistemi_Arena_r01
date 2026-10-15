// E-imza sağlayıcı webhook'u. İmza (HMAC-SHA256 + zaman penceresi) doğrulanmadan hiçbir şey işlenmez.
// Aynı olay ikinci kez gelirse yeniden işlenmez (idempotent). Yapılandırma yoksa 503.
import { createHash } from "node:crypto";
import { IntegrationError, parseSignCompletion, readEnv, verifyWebhookSignature } from "@ekos/adapters";
import { completeWebhook, DomainError, receiveWebhook, recordSignedVersion, scanFile } from "@ekos/db";
import { antivirus, db, storage } from "@/lib/server/runtime";
import { newCorrelationId } from "@/lib/server/http";

const MAX_BODY = 1_000_000;

export async function POST(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const secret = readEnv(process.env, "ESIGN_WEBHOOK_SECRET");
  if (!secret) return Response.json({ code: "SERVICE_UNAVAILABLE", correlationId: cid }, { status: 503 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return Response.json({ code: "PAYLOAD_TOO_LARGE", correlationId: cid }, { status: 413 });

  const sig = verifyWebhookSignature({
    secret,
    header: req.headers.get("x-ekos-signature"),
    rawBody: raw,
    nowUnixSeconds: Math.floor(Date.now() / 1000),
  });
  if (!sig.ok) return Response.json({ code: sig.code, correlationId: cid }, { status: 401 });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return Response.json({ code: "VALIDATION_FAILED", correlationId: cid }, { status: 400 });
  }
  const eventId = typeof parsed.id === "string" && parsed.id.length > 0 && parsed.id.length <= 200 ? parsed.id : null;
  if (!eventId) return Response.json({ code: "VALIDATION_FAILED", correlationId: cid }, { status: 400 });

  const decision = await receiveWebhook(db(), {
    provider: "esignature",
    externalEventId: eventId,
    payloadHash: createHash("sha256").update(raw).digest("hex"),
  });
  if (decision.decision === "DUPLICATE") return Response.json({ status: "DUPLICATE", correlationId: cid }, { status: 200 });
  if (decision.decision === "IN_PROGRESS") return Response.json({ status: "IN_PROGRESS", correlationId: cid }, { status: 409 });
  if (decision.decision === "PAYLOAD_MISMATCH") return Response.json({ status: "PAYLOAD_MISMATCH", correlationId: cid }, { status: 409 });

  if (parsed.type !== "transaction.completed") {
    await completeWebhook(db(), decision.eventId, { ok: true });
    return Response.json({ status: "IGNORED", correlationId: cid }, { status: 200 });
  }
  try {
    const c = parseSignCompletion(parsed);
    // İmzalı dosya (SHA-256 doğrulanmış) karantinaya yazılır; sözleşme yalnız tarama CLEAN olunca ACTIVE olur.
    const r = await recordSignedVersion(db(), storage(), {
      transactionId: c.transactionId,
      signedAt: c.signedAt,
      parties: c.parties.map((p) => ({ name: p.name })),
      signedFile: c.signedFile,
      signedFileSha256: c.signedFileSha256,
      correlationId: cid,
    });
    if (r.status === "UNKNOWN_TRANSACTION") {
      await completeWebhook(db(), decision.eventId, { ok: false, errorCode: "TRANSACTION_UNKNOWN" });
      return Response.json({ code: "TRANSACTION_UNKNOWN", correlationId: cid }, { status: 422 });
    }
    let scan: "CLEAN" | "INFECTED" | "UNAVAILABLE" | "NOT_CONFIGURED" | "SKIPPED_DUPLICATE" = "SKIPPED_DUPLICATE";
    if (!r.duplicate && r.fileObjectId) {
      const av = antivirus();
      if (av) {
        const s = await scanFile({ prisma: db(), storage: storage(), av }, { fileObjectId: r.fileObjectId, actorId: null, correlationId: cid });
        scan = s.status;
      } else {
        scan = "NOT_CONFIGURED";
      }
    }
    await completeWebhook(db(), decision.eventId, { ok: true });
    return Response.json(
      { status: "PROCESSED", versionNumber: r.versionNumber, duplicate: r.duplicate, scan, activated: r.activated, correlationId: cid },
      { status: 200 },
    );
  } catch (e) {
    const code = e instanceof IntegrationError || e instanceof DomainError ? e.code : "PROCESSING_FAILED";
    await completeWebhook(db(), decision.eventId, { ok: false, errorCode: code });
    console.error(`[webhook:esignature] cid=${cid} code=${code}`);
    return Response.json({ code, correlationId: cid }, { status: 422 });
  }
}
