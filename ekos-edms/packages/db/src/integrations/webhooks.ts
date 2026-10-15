// Idempotent webhook alımı (Faz 6, madde 1). (provider, externalEventId) tekildir.
// PROCESSED → yeniden işlenmez (DUPLICATE); FAILED → koşullu geçişle yeniden denenir; RECEIVED → işleniyor (IN_PROGRESS).
import { Prisma, type PrismaClient } from "@prisma/client";

export type WebhookDecision =
  | { readonly decision: "PROCESS"; readonly eventId: string }
  | { readonly decision: "DUPLICATE"; readonly eventId: string }
  | { readonly decision: "IN_PROGRESS"; readonly eventId: string }
  | { readonly decision: "PAYLOAD_MISMATCH"; readonly eventId: string };

export async function receiveWebhook(
  prisma: PrismaClient,
  input: { readonly provider: string; readonly externalEventId: string; readonly payloadHash: string; readonly now?: Date },
): Promise<WebhookDecision> {
  const now = input.now ?? new Date();
  try {
    const created = await prisma.webhookEvent.create({
      data: {
        provider: input.provider,
        externalEventId: input.externalEventId,
        payloadHash: input.payloadHash,
        status: "RECEIVED",
        attempts: 1,
        receivedAt: now,
      },
      select: { id: true },
    });
    return { decision: "PROCESS", eventId: created.id };
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") throw e;
  }
  const existing = await prisma.webhookEvent.findUniqueOrThrow({
    where: { provider_externalEventId: { provider: input.provider, externalEventId: input.externalEventId } },
    select: { id: true, status: true, payloadHash: true },
  });
  if (existing.payloadHash !== input.payloadHash) return { decision: "PAYLOAD_MISMATCH", eventId: existing.id };
  if (existing.status === "PROCESSED") return { decision: "DUPLICATE", eventId: existing.id };
  if (existing.status === "RECEIVED") return { decision: "IN_PROGRESS", eventId: existing.id };
  // FAILED: koşullu geçiş; eşzamanlı iki yeniden deneme aynı olayı iki kez almaz.
  const moved = await prisma.webhookEvent.updateMany({
    where: { id: existing.id, status: "FAILED" },
    data: { status: "RECEIVED", attempts: { increment: 1 }, errorCode: null },
  });
  return moved.count === 1 ? { decision: "PROCESS", eventId: existing.id } : { decision: "IN_PROGRESS", eventId: existing.id };
}

export async function completeWebhook(
  prisma: PrismaClient,
  eventId: string,
  outcome: { readonly ok: true } | { readonly ok: false; readonly errorCode: string },
): Promise<void> {
  await prisma.webhookEvent.update({
    where: { id: eventId },
    data: outcome.ok
      ? { status: "PROCESSED", processedAt: new Date(), errorCode: null }
      : { status: "FAILED", errorCode: outcome.errorCode.replace(/[^A-Z0-9_]/g, "").slice(0, 80) || "UNKNOWN" },
  });
}
