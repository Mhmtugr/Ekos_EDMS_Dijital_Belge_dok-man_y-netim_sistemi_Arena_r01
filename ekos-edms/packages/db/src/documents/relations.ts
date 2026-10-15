// Belge ilişkileri (Faz 2, madde 11). Her iki uç için görünürlük ve izin ayrı ayrı denetlenir.
// Karşı uç görünür değilse ilişki listede gösterilmez (varlık sızmaz).
import type { ActorContext } from "@ekos/core";
import type { PrismaClient } from "@prisma/client";
import { appendAudit } from "../audit.js";
import { guardDocument } from "./guard.js";
import { documentVisibilitySql } from "./visibility.js";
import { DomainError } from "./shared.js";

export type RelationType = "PARENT_CHILD" | "ATTACHMENT" | "REVISION" | "ORDER_INVOICE" | "CONTRACT_DOCUMENT" | "AMENDMENT";

export async function linkDocuments(
  prisma: PrismaClient,
  input: { readonly actor: ActorContext; readonly now: Date; readonly correlationId: string; readonly fromId: string; readonly toId: string; readonly relationType: RelationType },
): Promise<{ id: string }> {
  if (input.fromId === input.toId) throw new DomainError("RELATION_INVALID", "Belge kendisiyle ilişkilendirilemez");
  await guardDocument(prisma, { actor: input.actor, now: input.now, documentId: input.fromId, permission: "document.edit_metadata" });
  await guardDocument(prisma, { actor: input.actor, now: input.now, documentId: input.toId, permission: "document.list" });
  return prisma.$transaction(async (tx) => {
    const dup = await tx.documentRelation.findFirst({ where: { fromDocumentId: input.fromId, toDocumentId: input.toId, relationType: input.relationType } });
    if (dup) throw new DomainError("RELATION_INVALID", "Bu ilişki zaten var");
    const rel = await tx.documentRelation.create({
      data: { fromDocumentId: input.fromId, toDocumentId: input.toId, relationType: input.relationType, createdBy: input.actor.userId },
    });
    await appendAudit(tx, {
      actorType: "USER",
      actorId: input.actor.userId,
      eventType: "DOCUMENT_RELATION_CREATED",
      targetType: "DOCUMENT",
      targetId: input.fromId,
      outcome: "SUCCESS",
      correlationId: input.correlationId,
      afterSummary: { toDocumentId: input.toId, relationType: input.relationType },
    });
    return { id: rel.id };
  });
}

export interface RelationView {
  readonly relationType: string;
  readonly direction: "OUT" | "IN";
  readonly document: { readonly id: string; readonly number: string; readonly title: string };
}

export async function listRelations(prisma: PrismaClient, input: { readonly actor: ActorContext; readonly now: Date; readonly documentId: string }): Promise<RelationView[]> {
  await guardDocument(prisma, { actor: input.actor, now: input.now, documentId: input.documentId, permission: "document.list" });
  const rels = await prisma.documentRelation.findMany({
    where: { OR: [{ fromDocumentId: input.documentId }, { toDocumentId: input.documentId }] },
  });
  const otherIds = rels.map((r) => (r.fromDocumentId === input.documentId ? r.toDocumentId : r.fromDocumentId));
  if (otherIds.length === 0) return [];
  const visible = await prisma.$queryRaw<{ id: string; number: string; title: string }[]>`
    SELECT d."id", d."number", d."title" FROM "Document" d
    WHERE d."id" = ANY(${otherIds}::uuid[]) AND ${documentVisibilitySql(input.actor, input.now)}`;
  const byId = new Map(visible.map((d) => [d.id, d]));
  const out: RelationView[] = [];
  for (const r of rels) {
    const outgoing = r.fromDocumentId === input.documentId;
    const other = byId.get(outgoing ? r.toDocumentId : r.fromDocumentId);
    if (!other) continue; // görünmeyen karşı taraf gizlenir
    out.push({ relationType: r.relationType, direction: outgoing ? "OUT" : "IN", document: other });
  }
  return out;
}
