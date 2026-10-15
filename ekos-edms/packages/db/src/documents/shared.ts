// Ortak yardımcılar: alan hataları (HTTP eşlemesiyle), belge numarası, metadata ayrıştırma, arama metni.
import { Prisma, type PrismaClient } from "@prisma/client";
import { normalizeForSearch } from "@ekos/core";

export type DomainErrorCode =
  | "NOT_FOUND"
  | "TYPE_NOT_FOUND"
  | "VERSION_CONFLICT"
  | "METADATA_DEFINITION_MISSING"
  | "REQUIRED_METADATA_MISSING"
  | "METADATA_INVALID"
  | "FILE_NOT_CLEAN"
  | "INTEGRITY_MISMATCH"
  | "OCR_NOT_RETRYABLE"
  | "REASON_REQUIRED"
  | "FILE_REJECTED"
  | "FILE_NOT_FOUND"
  | "FILE_AMBIGUOUS"
  | "FORBIDDEN"
  | "RELATION_INVALID"
  | "SAVED_VIEW_DUPLICATE"
  | "TRANSITION_DENIED"
  | "WORKFLOW_NOT_STARTABLE"
  | "DECISION_DENIED"
  | "VERSION_LOCKED"
  | "IDEMPOTENCY_CONFLICT"
  | "PROFILE_INVALID"
  | "PROFILE_NOT_VERIFIED"
  | "DISPOSAL_BLOCKED"
  | "DISPOSAL_STATE_INVALID"
  | "SEPARATION_OF_DUTIES"
  | "LEGAL_HOLD_ACTIVE"
  | "PHYSICAL_EVIDENCE_REQUIRED"
  | "DOCUMENT_DISPOSED"
  | "OFFBOARDING_STATE_INVALID"
  | "OFFBOARDING_UNRESOLVED"
  | "BREAK_GLASS_INVALID"
  | "RANGE_INVALID"
  | "FISCAL_YEAR_INVALID"
  | "VALIDATION_FAILED"
  | "SETTING_STATE_INVALID";

const STATUS: Record<DomainErrorCode, 403 | 404 | 409 | 422> = {
  NOT_FOUND: 404,
  TYPE_NOT_FOUND: 422,
  VERSION_CONFLICT: 409,
  METADATA_DEFINITION_MISSING: 422,
  REQUIRED_METADATA_MISSING: 422,
  METADATA_INVALID: 422,
  FILE_NOT_CLEAN: 422,
  INTEGRITY_MISMATCH: 422,
  OCR_NOT_RETRYABLE: 409,
  REASON_REQUIRED: 422,
  FILE_REJECTED: 422,
  FILE_NOT_FOUND: 422,
  FILE_AMBIGUOUS: 422,
  FORBIDDEN: 403,
  RELATION_INVALID: 422,
  SAVED_VIEW_DUPLICATE: 409,
  TRANSITION_DENIED: 422,
  WORKFLOW_NOT_STARTABLE: 422,
  DECISION_DENIED: 403,
  VERSION_LOCKED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  PROFILE_INVALID: 422,
  PROFILE_NOT_VERIFIED: 422,
  DISPOSAL_BLOCKED: 422,
  DISPOSAL_STATE_INVALID: 409,
  SEPARATION_OF_DUTIES: 403,
  LEGAL_HOLD_ACTIVE: 409,
  PHYSICAL_EVIDENCE_REQUIRED: 422,
  DOCUMENT_DISPOSED: 409,
  OFFBOARDING_STATE_INVALID: 409,
  OFFBOARDING_UNRESOLVED: 409,
  BREAK_GLASS_INVALID: 422,
  RANGE_INVALID: 422,
  FISCAL_YEAR_INVALID: 422,
  VALIDATION_FAILED: 422,
  SETTING_STATE_INVALID: 409,
};

/** Servis hatası. `status` HTTP eşlemesi içindir; mesaj güvenli, iç ayrıntı içermez. */
export class DomainError extends Error {
  readonly status: 403 | 404 | 409 | 422;
  constructor(readonly code: DomainErrorCode, message?: string) {
    super(message ?? code);
    this.name = "DomainError";
    this.status = STATUS[code];
  }
}

const SHORT_CODE_OVERRIDES: Record<string, string> = {};

/** Belge numarası için kısa tür kodu (EKOS-{TÜRKODU}-{YIL}-{6}). */
export function shortTypeCode(code: string): string {
  const override = SHORT_CODE_OVERRIDES[code];
  if (override) return override;
  const parts = code.split("_").filter((p) => p.length > 0);
  const initials = parts.length > 1 ? parts.map((p) => p[0] ?? "").join("") : (parts[0] ?? "").slice(0, 6);
  return initials.toUpperCase().slice(0, 12);
}

/** Tür+yıl bazlı sayaç. Aynı (tür, yıl) için işlemler sıraya girer (pg_advisory_xact_lock). ADR-0004. */
export async function nextDocumentNumber(tx: Prisma.TransactionClient, typeCode: string, year: number): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`numseq:${typeCode}:${String(year)}`}))`;
  const seq = await tx.numberSequence.upsert({
    where: { typeCode_year: { typeCode: shortTypeCode(typeCode), year } },
    create: { typeCode: shortTypeCode(typeCode), year, lastValue: 1 },
    update: { lastValue: { increment: 1 } },
  });
  return `EKOS-${shortTypeCode(typeCode)}-${String(year)}-${String(seq.lastValue).padStart(6, "0")}`;
}

export type MetadataInput = Readonly<Record<string, string>>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isRealIsoDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Metadata değerlerini tanımlara göre doğrular ve yazılabilir biçime çevirir.
 * Tanımsız anahtar → METADATA_DEFINITION_MISSING (sessiz kabul yok).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function parseMetadataValues(
  tx: Prisma.TransactionClient,
  input: MetadataInput,
): Promise<{ definitionId: string; key: string; valueText: string | null; valueDate: Date | null; valueNumber: Prisma.Decimal | null; searchable: string }[]> {
  const keys = Object.keys(input).filter((k) => k !== "title");
  if (keys.length === 0) return [];
  const defs = await tx.metadataDefinition.findMany({ where: { key: { in: keys }, isActive: true } });
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const out: { definitionId: string; key: string; valueText: string | null; valueDate: Date | null; valueNumber: Prisma.Decimal | null; searchable: string }[] = [];
  for (const key of keys) {
    const def = byKey.get(key);
    if (!def) throw new DomainError("METADATA_DEFINITION_MISSING", `Tanım yok: ${key}`);
    const raw = (input[key] ?? "").trim();
    if (raw === "") continue;
    switch (def.dataType) {
      case "DATE":
        if (!isRealIsoDate(raw)) throw new DomainError("METADATA_INVALID", `Tarih geçersiz: ${key}`);
        out.push({ definitionId: def.id, key, valueText: null, valueDate: new Date(`${raw}T00:00:00Z`), valueNumber: null, searchable: "" });
        break;
      case "NUMBER":
      case "DECIMAL": {
        if (!/^-?\d+(\.\d{1,4})?$/.test(raw)) throw new DomainError("METADATA_INVALID", `Sayı geçersiz: ${key}`);
        out.push({ definitionId: def.id, key, valueText: null, valueDate: null, valueNumber: new Prisma.Decimal(raw), searchable: raw });
        break;
      }
      case "REFERENCE": {
        // Referans: UUID biçimi + hedef kaydın varlığı zorunlu. Karşı taraf yalnızca AKTİF olabilir.
        if (!UUID_RE.test(raw)) throw new DomainError("METADATA_INVALID", `Referans geçersiz: ${key}`);
        if (key === "counterpartyId") {
          const cp = await tx.counterparty.findUnique({ where: { id: raw }, select: { officialName: true, status: true } });
          if (!cp) throw new DomainError("METADATA_INVALID", "Karşı taraf bulunamadı");
          if (cp.status !== "ACTIVE") throw new DomainError("METADATA_INVALID", "Karşı taraf pasif; belge bağlanamaz");
          out.push({ definitionId: def.id, key, valueText: raw, valueDate: null, valueNumber: null, searchable: cp.officialName });
        } else if (key === "parentDocumentId") {
          const parent = await tx.document.findUnique({ where: { id: raw }, select: { id: true } });
          if (!parent) throw new DomainError("METADATA_INVALID", "Ana belge bulunamadı");
          out.push({ definitionId: def.id, key, valueText: raw, valueDate: null, valueNumber: null, searchable: "" });
        } else {
          throw new DomainError("METADATA_INVALID", `Bu anahtar için referans desteklenmiyor: ${key}`);
        }
        break;
      }
      default:
        out.push({ definitionId: def.id, key, valueText: raw, valueDate: null, valueNumber: null, searchable: raw });
    }
  }
  return out;
}

/** Belgenin arama metni: başlık + metadata + (varsa) OCR metni. Türkçe normalize edilir. */
export function buildSearchText(title: string, metadataTexts: readonly string[], ocrText = ""): string {
  return normalizeForSearch([title, ...metadataTexts, ocrText].join(" \n "));
}

export async function requireActiveType(prisma: PrismaClient | Prisma.TransactionClient, code: string) {
  const type = await prisma.documentType.findUnique({ where: { code } });
  if (!type || !type.isActive) throw new DomainError("TYPE_NOT_FOUND", `Tür yok veya pasif: ${code}`);
  return type;
}
