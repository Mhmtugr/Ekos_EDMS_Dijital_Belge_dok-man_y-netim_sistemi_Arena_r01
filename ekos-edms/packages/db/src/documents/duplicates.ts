// Yükleme anında birebir kopya uyarısı (SHA-256). Yalnızca İŞLEMCİNİN GÖREBİLDİĞİ belgeler döner.
// Metadata benzerliği: findVisibleMetadataSimilar (yalnız uyarı; yükleme engellenmez).
import { Prisma, type PrismaClient } from "@prisma/client";
import type { ActorContext } from "@ekos/core";
import { documentVisibilitySql } from "./visibility.js";

export interface DuplicateHit {
  readonly documentId: string;
  readonly number: string;
  readonly title: string;
}

export async function findVisibleExactDuplicates(
  prisma: PrismaClient,
  actor: ActorContext,
  input: { readonly sha256: string; readonly excludeFileObjectId: string; readonly now?: Date },
): Promise<DuplicateHit[]> {
  const vis = documentVisibilitySql(actor, input.now ?? new Date());
  const rows = await prisma.$queryRaw<{ id: string; number: string; title: string }[]>(Prisma.sql`
    SELECT d."id", d."number", d."title"
    FROM "Document" d
    JOIN "DocumentVersion" v ON v."documentId" = d."id"
    JOIN "DocumentFileObject" f ON f."id" = v."fileObjectId"
    WHERE f."sha256" = ${input.sha256}
      AND f."id" <> ${input.excludeFileObjectId}::uuid
      AND ${vis}
    ORDER BY d."createdAt" DESC
    LIMIT 5`);
  return rows.map((r) => ({ documentId: r.id, number: r.number, title: r.title }));
}

export interface SimilarMetadataHit {
  readonly documentId: string;
  readonly number: string;
  readonly title: string;
}

/**
 * Metadata benzerliği — YALNIZ UYARI (Faz 2 kararı). Aynı tür + aynı karşı taraf (+ verildiyse aynı tutar)
 * görünür belgeler listelenir. Yükleme engellenmez; yalnızca kullanıcıya gösterilir. Yetki: görünürlük SQL'i.
 */
export async function findVisibleMetadataSimilar(
  prisma: PrismaClient,
  actor: ActorContext,
  input: { readonly typeId: string; readonly counterpartyId: string; readonly amount?: string | null; readonly now?: Date },
): Promise<SimilarMetadataHit[]> {
  const vis = documentVisibilitySql(actor, input.now ?? new Date());
  const amountClause = input.amount
    ? Prisma.sql`AND EXISTS (SELECT 1 FROM "MetadataValue" mva JOIN "MetadataDefinition" mda ON mda."id" = mva."definitionId"
        WHERE mva."documentId" = d."id" AND mda."key" = 'amount' AND mva."valueNumber" = ${input.amount}::numeric)`
    : Prisma.empty;
  const rows = await prisma.$queryRaw<{ id: string; number: string; title: string }[]>(Prisma.sql`
    SELECT d."id", d."number", d."title"
    FROM "Document" d
    WHERE d."typeId" = ${input.typeId}::uuid
      AND EXISTS (SELECT 1 FROM "MetadataValue" mv JOIN "MetadataDefinition" md ON md."id" = mv."definitionId"
        WHERE mv."documentId" = d."id" AND md."key" = 'counterpartyId' AND mv."valueText" = ${input.counterpartyId})
      ${amountClause}
      AND ${vis}
    ORDER BY d."createdAt" DESC
    LIMIT 5`);
  return rows.map((r) => ({ documentId: r.id, number: r.number, title: r.title }));
}
