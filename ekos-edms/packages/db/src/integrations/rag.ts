// Belge soru-cevap (RAG, Faz 6 madde 4). Akış:
//  1) Sorgu terimleri (normalize) → 2) SQL içinde yetki filtresi + tam metin eşleşmesi (yalnız GÜNCEL sürüm parçaları)
//  3) Yalnız yetkili pasajlar AI'ya gider (embedding/şema yok) → 4) çıktı şemayla doğrulanır, atıf yalnız verilen kimlikler
//  5) ÜRETİM SONRASI yetki yeniden doğrulanır (atıf yapılan belgeler hâlâ görünür olmalı) → 6) dayanak yoksa NOT_FOUND.
// Sorgu metni denetime YAZILMAZ (yalnız sayılar ve sonuç).
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  NOT_FOUND_ANSWER,
  buildAnswerPrompt,
  normalizeQueryTerms,
  snippet,
  validateAnswerOutput,
  type ActorContext,
} from "@ekos/core";
import { documentVisibilitySql } from "../documents/visibility.js";
import { appendAudit } from "../audit.js";

/** Metin üretimi portu (AiProvider ile uyumlu). Yapılandırılmamışsa çağrılmaz. */
export interface AnswerModel {
  generateJson(input: { readonly system: string; readonly user: string; readonly timeoutMs?: number }): Promise<
    { readonly ok: true; readonly json: unknown } | { readonly ok: false; readonly code: string }
  >;
}

export interface RagSource {
  readonly documentId: string;
  readonly documentNumber: string;
  readonly title: string;
  readonly page: number;
  readonly snippet: string;
}

export type RagResult =
  | { readonly status: "ANSWERED"; readonly answer: string; readonly sources: readonly RagSource[] }
  | { readonly status: "NOT_FOUND"; readonly answer: typeof NOT_FOUND_ANSWER; readonly sources: readonly [] }
  | { readonly status: "PASSAGES_ONLY"; readonly reason: "AI_NOT_CONFIGURED" | "AI_UNAVAILABLE" | "AI_NOT_APPROVED_FOR_TYPE"; readonly sources: readonly RagSource[] };

const MAX_TERMS = 12;
const MAX_PASSAGES = 8;

interface PassageRow {
  id: string;
  documentId: string;
  number: string;
  title: string;
  typeCode: string;
  page: number;
  text: string;
  rank: number;
}

export async function askDocuments(
  prisma: PrismaClient,
  input: {
    readonly actor: ActorContext;
    readonly question: string;
    readonly correlationId: string;
    readonly model: AnswerModel | null;
    /** Dış AI'ya yalnız bu belge türleri gönderilir (R-AI-03). Boşsa hiçbir pasaj AI'ya gitmez. */
    readonly approvedTypeCodes?: readonly string[];
    readonly now?: Date;
  },
): Promise<RagResult> {
  const now = input.now ?? new Date();
  const terms = normalizeQueryTerms(input.question).slice(0, MAX_TERMS);
  if (terms.length === 0) return finish(prisma, input, { status: "NOT_FOUND", answer: NOT_FOUND_ANSWER, sources: [] }, 0);

  const tsquery = terms.map((t) => `${t}:*`).join(" & ");
  const visible = documentVisibilitySql(input.actor, now);
  const rows = await prisma.$queryRaw<PassageRow[]>(Prisma.sql`
    SELECT c.id, d.id AS "documentId", d."number", d."title", t."code" AS "typeCode", c.page, c.text,
           ts_rank(c."searchVector", to_tsquery('simple', ${tsquery})) AS rank
    FROM "DocumentTextChunk" c
    JOIN "Document" d ON d.id = c."documentId"
    JOIN "DocumentType" t ON t.id = d."typeId"
    JOIN "DocumentVersion" v ON v.id = d."currentVersionId" AND v."fileObjectId" = c."fileObjectId"
    WHERE c."searchVector" @@ to_tsquery('simple', ${tsquery})
      AND ${visible}
    ORDER BY rank DESC, c.page ASC, c.ordinal ASC
    LIMIT ${MAX_PASSAGES}`);

  if (rows.length === 0) return finish(prisma, input, { status: "NOT_FOUND", answer: NOT_FOUND_ANSWER, sources: [] }, 0);

  const toSource = (r: PassageRow): RagSource => ({
    documentId: r.documentId,
    documentNumber: r.number,
    title: r.title,
    page: r.page,
    snippet: snippet(r.text, 200),
  });

  if (input.model === null) {
    return finish(prisma, input, { status: "PASSAGES_ONLY", reason: "AI_NOT_CONFIGURED", sources: rows.map(toSource) }, rows.length);
  }
  const approved = new Set(input.approvedTypeCodes ?? []);
  const aiRows = rows.filter((r) => approved.has(r.typeCode));
  if (aiRows.length === 0) {
    return finish(prisma, input, { status: "PASSAGES_ONLY", reason: "AI_NOT_APPROVED_FOR_TYPE", sources: rows.map(toSource) }, rows.length);
  }

  // Modele gönderilen kimlikler geçici (P1..Pn); gerçek chunk kimlikleri dışarı sızmaz.
  const idMap = new Map<string, PassageRow>(aiRows.map((r, i) => [`P${String(i + 1)}`, r]));
  const prompt = buildAnswerPrompt(input.question, [...idMap].map(([id, r]) => ({ id, text: r.text })));
  const out = await input.model.generateJson({ system: prompt.system, user: prompt.user, timeoutMs: 30_000 });
  if (!out.ok) {
    return finish(prisma, input, { status: "PASSAGES_ONLY", reason: "AI_UNAVAILABLE", sources: rows.map(toSource) }, rows.length, out.code);
  }

  const parsed = validateAnswerOutput(out.json, new Set(idMap.keys()));
  if (!parsed) return finish(prisma, input, { status: "NOT_FOUND", answer: NOT_FOUND_ANSWER, sources: [] }, rows.length);

  // ÜRETİM SONRASI yetki yeniden doğrulaması: atıf yapılan her belge hâlâ bu aktör için görünür olmalı.
  const citedRows = parsed.citations.map((c) => idMap.get(c)).filter((r): r is PassageRow => r !== undefined);
  const docIds = [...new Set(citedRows.map((r) => r.documentId))];
  const stillVisible = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT d.id FROM "Document" d
    WHERE d.id = ANY(${docIds}::uuid[]) AND ${documentVisibilitySql(input.actor, new Date())}`);
  const allowed = new Set(stillVisible.map((r) => r.id));
  const sources = citedRows.filter((r) => allowed.has(r.documentId)).map(toSource);
  if (sources.length === 0) return finish(prisma, input, { status: "NOT_FOUND", answer: NOT_FOUND_ANSWER, sources: [] }, rows.length, "POST_AUTHZ_DROPPED");
  return finish(prisma, input, { status: "ANSWERED", answer: parsed.answer, sources }, rows.length);
}

async function finish(
  prisma: PrismaClient,
  input: { readonly actor: ActorContext; readonly correlationId: string },
  result: RagResult,
  passageCount: number,
  detail?: string,
): Promise<RagResult> {
  await prisma.$transaction((tx) =>
    appendAudit(tx, {
      actorType: "USER",
      actorId: input.actor.userId,
      eventType: "rag.query",
      targetType: "DocumentSearch",
      targetId: null,
      outcome: "SUCCESS",
      correlationId: input.correlationId,
      afterSummary: {
        status: result.status,
        passageCount,
        sourceCount: result.sources.length,
        ...(result.status === "PASSAGES_ONLY" ? { reason: result.reason } : {}),
        ...(detail ? { detail: detail.replace(/[^A-Z0-9_]/g, "").slice(0, 80) } : {}),
      },
    }),
  );
  return result;
}
