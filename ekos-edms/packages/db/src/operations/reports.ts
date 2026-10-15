// Raporlar ve dışa aktarma (Faz 5, madde 5). Her rapor yetki kapısından geçer; sonuç kapsam özeti ve
// (hassas raporlarda) filigran taşır; her dışa aktarma ve her reddedilen deneme denetime yazılır.
// Kayıt sayısı sınırı aşılırsa sessiz kırpma YAPILMAZ: REPORT_TOO_LARGE döner.
import { Prisma, type PrismaClient } from "@prisma/client";
import { authorize, type ActorContext } from "@ekos/core";
import { appendAudit } from "../audit.js";
import { DomainError } from "../documents/shared.js";
import { documentVisibilitySql } from "../documents/visibility.js";
import { istanbulDate, recordDenied } from "../governance/common.js";
import { addDays } from "./reminders.js";
import { toCsv, toXlsx, sha256Hex, type Cell } from "./exports.js";
import { getCurrentSetting, SETTING_KEYS } from "./settings.js";
import { hasAnyGrant } from "./dashboard.js";

/**
 * global: true → izin yalnız kapsamsız (global) üyelikle verilir (denetim kayıtları gibi kurum geneli veri).
 * global: false → izin herhangi bir aktif üyelikte yeterlidir; veri kapsamı documentVisibilitySql ile uygulanır.
 */
export const REPORT_TYPES = {
  CONTRACT_PORTFOLIO: { title: "Sözleşme portföyü", permission: "document.list", sensitive: true, global: false },
  CONTRACT_DEADLINES: { title: "Yaklaşan sözleşme süreleri", permission: "document.list", sensitive: false, global: false },
  OBLIGATIONS_OPEN: { title: "Açık yükümlülükler", permission: "document.list", sensitive: false, global: false },
  APPROVALS_OPEN: { title: "Açık onay görevleri", permission: "document.approve", sensitive: false, global: false },
  AUDIT_EXTRACT: { title: "Denetim kayıtları", permission: "audit.export", sensitive: true, global: true },
} as const;
export type ReportType = keyof typeof REPORT_TYPES;
export const REPORT_TYPE_KEYS = Object.keys(REPORT_TYPES) as ReportType[];

export const EXPORT_ROW_LIMIT = 10_000;
const DEFAULT_RESTRICTED_LIMIT = 1_000;

export interface ReportFilters {
  readonly from?: string | undefined; // YYYY-MM-DD
  readonly to?: string | undefined;
  readonly days?: number | undefined; // süre penceresi (CONTRACT_DEADLINES), varsayılan 90
  readonly counterpartyId?: string | undefined;
}

export interface ReportDataset {
  readonly type: ReportType;
  readonly title: string;
  readonly sensitive: boolean;
  readonly scopeSummary: string;
  readonly columns: string[];
  readonly rows: Cell[][];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
function checkDay(v: string | undefined, label: string): void {
  if (v !== undefined && !DAY.test(v)) throw new DomainError("VALIDATION_FAILED", `${label} biçimi YYYY-AA-GG olmalı`);
}
const dayStr = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);

/** Rapor kapısı: genel raporlar için izin varlığı, kurum geneli raporlar için kapsamsız üyelik. */
function reportGranted(actor: ActorContext, def: { permission: string; global: boolean }, now: Date): boolean {
  if (def.global) return authorize({ actor, permission: def.permission, now }).allowed;
  return hasAnyGrant(actor, def.permission, now);
}

/** Rapor veri kümesini (yetki + görünürlük filtreli) üretir. Sınır aşılırsa REPORT_TOO_LARGE. */
export async function buildReportDataset(
  prisma: PrismaClient,
  input: { actor: ActorContext; now: Date; type: ReportType; filters: ReportFilters; limit: number },
): Promise<ReportDataset> {
  const { actor, now, type, filters } = input;
  checkDay(filters.from, "Başlangıç");
  checkDay(filters.to, "Bitiş");
  // Anahtar kontrolü: kullanıcı girdisi (ör. __proto__) rapor tanımı sayılmaz.
  const def = Object.prototype.hasOwnProperty.call(REPORT_TYPES, type) ? REPORT_TYPES[type] : undefined;
  if (!def) throw new DomainError("VALIDATION_FAILED", "Bilinmeyen rapor türü");
  if (!reportGranted(actor, def, now)) throw new DomainError("FORBIDDEN", "Bu rapor için yetkiniz yok");
  const today = istanbulDate(now);
  const vis = documentVisibilitySql(actor, now);
  const cp = filters.counterpartyId ?? null;
  const from = filters.from ?? today;
  const to = filters.to ?? addDays(today, filters.days ?? 90);
  let columns: string[];
  let rows: Cell[][];
  let scope: string;

  if (type === "CONTRACT_PORTFOLIO" || type === "CONTRACT_DEADLINES") {
    const rowsRaw = await prisma.$queryRaw<{
      number: string; title: string; contractType: string; counterpartyName: string; status: string | null; startDate: Date | null;
      endDate: Date | null; autoRenewal: boolean | null; amount: string | null; currency: string | null; ownerName: string | null;
    }[]>`
      SELECT d."number", c."title", c."contractType", cp."officialName" AS "counterpartyName",
             d."contractStatus"::text AS status, c."startDate", c."endDate", c."autoRenewal",
             c."amount"::text AS amount, c."currency", u."displayName" AS "ownerName"
      FROM "ContractRecord" c
      JOIN "Document" d ON d."id" = c."documentId"
      JOIN "Counterparty" cp ON cp."id" = c."counterpartyId"
      LEFT JOIN "User" u ON u."id" = d."ownerId"
      WHERE ${vis}
        AND (${cp}::uuid IS NULL OR c."counterpartyId" = ${cp}::uuid)
        AND ${type === "CONTRACT_DEADLINES"
          ? Prisma.sql`c."endDate" >= ${from}::date AND c."endDate" <= ${to}::date`
          : Prisma.sql`TRUE`}
      ORDER BY c."endDate" ASC NULLS LAST, d."number" ASC
      LIMIT ${input.limit + 1}`;
    if (rowsRaw.length > input.limit) throw new DomainError("VALIDATION_FAILED", `Rapor ${String(input.limit)} kaydı aşıyor; filtreleri daraltın`);
    columns = ["Belge No", "Başlık", "Sözleşme türü", "Karşı taraf", "Durum", "Başlangıç", "Bitiş", "Otomatik yenileme", "Tutar", "Para birimi", "Sorumlu"];
    rows = rowsRaw.map((r) => [r.number, r.title, r.contractType, r.counterpartyName, r.status, dayStr(r.startDate), dayStr(r.endDate),
      r.autoRenewal === null ? null : r.autoRenewal ? "Evet" : "Hayır", r.amount, r.currency, r.ownerName]);
    scope = type === "CONTRACT_DEADLINES" ? `Bitiş tarihi ${from} – ${to}` : `Tüm görünür sözleşmeler${cp ? ", seçili karşı taraf" : ""}`;
  } else if (type === "OBLIGATIONS_OPEN") {
    const rowsRaw = await prisma.$queryRaw<{ number: string; description: string; dueDate: Date | null; status: string; responsible: string | null }[]>`
      SELECT d."number", o."description", o."dueDate", o."status"::text AS status, u."displayName" AS responsible
      FROM "Obligation" o JOIN "ContractRecord" c ON c."id" = o."contractId" JOIN "Document" d ON d."id" = c."documentId"
      LEFT JOIN "User" u ON u."id" = o."responsibleUserId"
      WHERE ${vis} AND o."status" = 'OPEN' AND (${cp}::uuid IS NULL OR c."counterpartyId" = ${cp}::uuid)
      ORDER BY o."dueDate" ASC NULLS LAST LIMIT ${input.limit + 1}`;
    if (rowsRaw.length > input.limit) throw new DomainError("VALIDATION_FAILED", `Rapor ${String(input.limit)} kaydı aşıyor; filtreleri daraltın`);
    columns = ["Belge No", "Yükümlülük", "Son tarih", "Durum", "Sorumlu"];
    rows = rowsRaw.map((r) => [r.number, r.description, dayStr(r.dueDate), r.status, r.responsible]);
    scope = "Açık yükümlülükler (görünür belgeler)";
  } else if (type === "APPROVALS_OPEN") {
    const rowsRaw = await prisma.$queryRaw<{ number: string; stepName: string | null; assignee: string | null; dueAt: Date | null; status: string }[]>`
      SELECT d."number", ('Adım ' || s."orderIndex"::text) AS "stepName", u."displayName" AS assignee, t."dueAt", t."status"::text AS status
      FROM "ApprovalTask" t JOIN "WorkflowStep" s ON s."id" = t."stepId"
      JOIN "WorkflowInstance" i ON i."id" = s."instanceId"
      JOIN "ContractRecord" c ON c."id" = i."subjectId" JOIN "Document" d ON d."id" = c."documentId"
      LEFT JOIN "User" u ON u."id" = t."assigneeId"
      WHERE t."status" = 'PENDING' AND i."subjectType" = 'CONTRACT' AND ${vis}
      ORDER BY t."dueAt" ASC NULLS LAST LIMIT ${input.limit + 1}`;
    if (rowsRaw.length > input.limit) throw new DomainError("VALIDATION_FAILED", `Rapor ${String(input.limit)} kaydı aşıyor; filtreleri daraltın`);
    columns = ["Belge No", "Adım", "Atanan", "Son tarih", "Durum"];
    rows = rowsRaw.map((r) => [r.number, r.stepName, r.assignee, r.dueAt ? r.dueAt.toISOString() : null, r.status]);
    scope = "Bekleyen onay görevleri (görünür belgeler)";
  } else {
    // AUDIT_EXTRACT — yalnız audit.export izni; zaman aralığı zorunlu ve en fazla 366 gün.
    const fromD = new Date(`${from}T00:00:00+03:00`);
    const toD = new Date(`${addDays(to, 1)}T00:00:00+03:00`);
    if (toD.getTime() - fromD.getTime() > 366 * 86_400_000) throw new DomainError("VALIDATION_FAILED", "Denetim raporu en fazla 366 günlük olabilir");
    const events = await prisma.auditEvent.findMany({
      where: { occurredAt: { gte: fromD, lt: toD } },
      orderBy: { sequence: "asc" },
      take: input.limit + 1,
      select: { sequence: true, occurredAt: true, actorType: true, actorId: true, eventType: true, targetType: true, targetId: true, outcome: true, correlationId: true },
    });
    if (events.length > input.limit) throw new DomainError("VALIDATION_FAILED", `Rapor ${String(input.limit)} kaydı aşıyor; tarih aralığını daraltın`);
    columns = ["Sıra", "Zaman", "Aktör türü", "Aktör", "Olay", "Hedef türü", "Hedef", "Sonuç", "Korelasyon"];
    rows = events.map((e) => [e.sequence.toString(), e.occurredAt.toISOString(), e.actorType, e.actorId, e.eventType, e.targetType, e.targetId, e.outcome, e.correlationId]);
    scope = `Denetim olayları ${from} – ${to}`;
  }
  return { type, title: def.title, sensitive: def.sensitive, scopeSummary: scope, columns, rows };
}


// ---------- Çıktı biçimi ----------
const FILE_SAFE = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, "-");

export interface ExportResult {
  readonly filename: string;
  readonly mime: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly rowCount: number;
  readonly watermark: string | null;
}

export function renderExport(
  ds: ReportDataset,
  opts: { format: "CSV" | "XLSX"; actorName: string; actorId: string; now: Date; restricted: boolean; correlationId: string },
): ExportResult {
  const stamp = istanbulDate(opts.now);
  const watermark = ds.sensitive
    ? `${opts.restricted ? "KISITLI" : "GİZLİ"} — ${opts.actorName} — ${opts.now.toISOString()}`
    : null;
  const meta: Cell[][] = [
    [`EKOS EDMS — ${ds.title}`],
    [`Oluşturan: ${opts.actorName} (${opts.actorId})`],
    [`Oluşturulma: ${opts.now.toISOString()} (Europe/Istanbul günü ${stamp})`],
    [`Kapsam: ${ds.scopeSummary}. Yalnızca oluşturanın görme yetkisi olan kayıtlar dahildir.`],
    [`Kayıt sayısı: ${String(ds.rows.length)}`],
    [`Korelasyon: ${opts.correlationId}`],
  ];
  if (watermark) meta.push([`FİLİGRAN: ${watermark}`]);
  const data: Cell[][] = [...meta, [], ds.columns, ...ds.rows];
  const base = `${FILE_SAFE(ds.type)}_${stamp}${opts.restricted ? "_KISITLI" : ""}`;
  const bytes = opts.format === "CSV" ? toCsv(data) : toXlsx(data, ds.title.slice(0, 31));
  const filename = `${base}.${opts.format === "CSV" ? "csv" : "xlsx"}`;
  const mime = opts.format === "CSV" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return { filename, mime, bytes, sha256: sha256Hex(bytes), rowCount: ds.rows.length, watermark };
}

/**
 * Dışa aktarma: yetki kapısı, sınır, biçim, audit. Reddedilen deneme ayrı işlemde audit'e yazılır.
 * restricted=true: kısıtlı indirme (yalnızca sistem ayarındaki kısıtlı sınıra kadar; dosya adı ve filigran "KISITLI").
 */
export async function exportReport(
  prisma: PrismaClient,
  input: { actor: ActorContext; now: Date; correlationId: string; type: ReportType; format: "CSV" | "XLSX"; filters: ReportFilters; restricted?: boolean },
): Promise<ExportResult & { dataset: { type: ReportType; scopeSummary: string } }> {
  // Anahtar kontrolü: kullanıcı girdisi (ör. __proto__) rapor tanımı sayılmaz.
  const def = Object.prototype.hasOwnProperty.call(REPORT_TYPES, input.type) ? REPORT_TYPES[input.type] : undefined;
  const denied = (reason: string) =>
    recordDenied(prisma, { actorId: input.actor.userId, eventType: "REPORT_EXPORT_DENIED", targetType: "REPORT", targetId: null, reason, correlationId: input.correlationId });
  if (!def) throw new DomainError("VALIDATION_FAILED", "Bilinmeyen rapor türü");
  if (!reportGranted(input.actor, def, input.now)) {
    await denied(`permission:${def.permission}`);
    throw new DomainError("FORBIDDEN", "Bu rapor için yetkiniz yok");
  }
  if (input.restricted && !def.sensitive) {
    // Kısıtlı indirme yalnız hassas raporlar için anlamlıdır; sessizce normal indirmeye düşmez.
    throw new DomainError("VALIDATION_FAILED", "Kısıtlı indirme yalnızca hassas raporlar için kullanılabilir");
  }
  const restrictedSetting = (await getCurrentSetting(prisma, SETTING_KEYS.EXPORT_POLICY)) as { restrictedRowLimit?: number } | null;
  const restrictedLimit = Math.min(restrictedSetting?.restrictedRowLimit ?? DEFAULT_RESTRICTED_LIMIT, EXPORT_ROW_LIMIT);
  const limit = input.restricted ? restrictedLimit : EXPORT_ROW_LIMIT;
  let ds: ReportDataset;
  try {
    ds = await buildReportDataset(prisma, { actor: input.actor, now: input.now, type: input.type, filters: input.filters, limit });
  } catch (e) {
    if (e instanceof DomainError && e.code === "FORBIDDEN") await denied("scope");
    throw e;
  }
  const actorRow = await prisma.user.findUnique({ where: { id: input.actor.userId }, select: { displayName: true } });
  const actorName = actorRow?.displayName ?? "bilinmeyen";
  const out = renderExport(ds, { format: input.format, actorName, actorId: input.actor.userId, now: input.now, restricted: !!input.restricted, correlationId: input.correlationId });
  await prisma.$transaction(async (tx) => {
    await appendAudit(tx, {
      actorType: "USER",
      actorId: input.actor.userId,
      eventType: input.restricted ? "REPORT_EXPORTED_RESTRICTED" : "REPORT_EXPORTED",
      targetType: "REPORT",
      targetId: null,
      outcome: "SUCCESS",
      correlationId: input.correlationId,
      afterSummary: { reportType: input.type, format: input.format, rowCount: out.rowCount, sha256: out.sha256, filename: out.filename, watermark: out.watermark !== null, scope: ds.scopeSummary },
    });
  });
  return { ...out, dataset: { type: ds.type, scopeSummary: ds.scopeSummary } };
}
