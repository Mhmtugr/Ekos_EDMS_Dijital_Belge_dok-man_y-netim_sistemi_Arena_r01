// Arama (Faz 2, madde 6-7): Türkçe normalize sorgu, tam metin (searchVector), filtreler, imleç sayfalama.
// Yetki filtresi SORGUNUN İÇİNDEDİR (documentVisibilitySql); sonradan süzme yoktur → sayfa boyutu/toplam tutarlı kalır.
import { Prisma, type PrismaClient } from "@prisma/client";
import { normalizeQueryTerms, type ActorContext, type ConfidentialityLevel } from "@ekos/core";
import { documentVisibilitySql } from "./visibility.js";

export interface SearchInput {
  readonly actor: ActorContext;
  readonly now: Date;
  readonly query: string;
  readonly typeCode?: string;
  readonly ingestStatus?: string;
  readonly confidentiality?: ConfidentialityLevel;
  readonly createdFrom?: Date;
  readonly createdTo?: Date;
  readonly limit?: number;
  /** Önceki sayfanın son öğesi: "ISO|uuid" */
  readonly cursor?: string;
}

export interface SearchHit {
  readonly id: string;
  readonly number: string;
  readonly title: string;
  readonly ingestStatus: string;
  readonly confidentiality: string;
  readonly createdAt: Date;
}

export interface SearchPage {
  readonly items: readonly SearchHit[];
  readonly nextCursor: string | null;
}

const MAX_LIMIT = 100;

export function encodeCursor(createdAt: Date, id: string): string {
  return `${createdAt.toISOString()}|${id}`;
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  const [iso, id] = cursor.split("|");
  if (!iso || !id || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return { createdAt: d, id };
}

export async function searchDocuments(prisma: PrismaClient, input: SearchInput): Promise<SearchPage> {
  const terms = normalizeQueryTerms(input.query);
  if (terms.length === 0) return { items: [], nextCursor: null };
  // Terimler yalnızca harf/rakamdır (normalize garanti eder); önek araması için ":*".
  const tsquery = terms.map((t) => `${t}:*`).join(" & ");
  const limit = Math.min(Math.max(input.limit ?? 20, 1), MAX_LIMIT);

  const filters: Prisma.Sql[] = [Prisma.sql`d."searchVector" @@ to_tsquery('simple', ${tsquery})`];
  if (input.typeCode) filters.push(Prisma.sql`t."code" = ${input.typeCode}`);
  if (input.ingestStatus) filters.push(Prisma.sql`d."ingestStatus" = ${input.ingestStatus}::"IngestStatus"`);
  if (input.confidentiality) filters.push(Prisma.sql`d."confidentiality" = ${input.confidentiality}::"ConfidentialityLevel"`);
  if (input.createdFrom) filters.push(Prisma.sql`d."createdAt" >= ${input.createdFrom}`);
  if (input.createdTo) filters.push(Prisma.sql`d."createdAt" < ${input.createdTo}`);
  if (input.cursor) {
    const c = decodeCursor(input.cursor);
    if (!c) throw new Error("Geçersiz imleç");
    filters.push(Prisma.sql`(d."createdAt", d."id") < (${c.createdAt}, ${c.id}::uuid)`);
  }
  filters.push(documentVisibilitySql(input.actor, input.now));

  const rows = await prisma.$queryRaw<SearchHit[]>`
    SELECT d."id", d."number", d."title", d."ingestStatus"::text AS "ingestStatus",
           d."confidentiality"::text AS "confidentiality", d."createdAt"
    FROM "Document" d
    JOIN "DocumentType" t ON t."id" = d."typeId"
    WHERE ${Prisma.join(filters, " AND ")}
    ORDER BY d."createdAt" DESC, d."id" DESC
    LIMIT ${limit + 1}`;

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

/**
 * Aynı SHA-256'ya sahip, KULLANICININ GÖREBİLDİĞİ belgeler. Görünmeyen kopyaların varlığı sızdırılmaz.
 */
export async function findVisibleDuplicates(prisma: PrismaClient, actor: ActorContext, now: Date, sha256: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT d."id"
    FROM "Document" d
    JOIN "DocumentVersion" v ON v."id" = d."currentVersionId"
    JOIN "DocumentFileObject" f ON f."id" = v."fileObjectId"
    WHERE f."sha256" = ${sha256}
      AND ${documentVisibilitySql(actor, now)}`;
  return rows.map((r) => r.id);
}
