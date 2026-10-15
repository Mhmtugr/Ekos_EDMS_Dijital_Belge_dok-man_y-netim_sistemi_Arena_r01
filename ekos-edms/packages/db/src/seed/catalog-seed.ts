// Sistem kataloğu tohumlama (idempotent): izinler, rol şablonları, metadata tanımları, saklama profilleri, belge türleri.
// Saklama süreleri KURUM POLİTİKASIDIR: seed-data/retention-profiles.json'dan okunur, uydurulmaz.
// Profil bağlı olmayan tür pasif kalır (core kuralı). Profil "politika bekliyor" ise tür kullanılabilir, otomatik imha kapalıdır.
import { readFileSync } from "node:fs";
import { BASE_DOCUMENT_TYPES, PERMISSION_CODES, ROLE_TEMPLATES } from "@ekos/core";
import type { DisposalMethod, PrismaClient, RetentionStartEvent, RetentionUnit } from "@prisma/client";

const START_EVENTS = ["DOCUMENT_CREATED", "CONTRACT_END", "FISCAL_YEAR_END", "MANUAL_EVENT"] as const;
const UNITS = ["CALENDAR_MONTHS", "CALENDAR_YEARS"] as const;
const DISPOSAL = ["DIGITAL_DELETE", "PHYSICAL_DESTRUCTION_RECORD"] as const;

export interface RetentionFileProfile {
  readonly code: string;
  readonly name: string;
  readonly startEvent: string | null;
  readonly durationValue: number | null;
  readonly durationUnit: string | null;
  readonly disposalMethod: string | null;
  readonly verifiedByLegal: boolean;
  readonly basisNote: string | null;
}

export interface SeedReport {
  readonly permissions: number;
  readonly roles: number;
  readonly metadataDefinitions: number;
  readonly retentionProfiles: number;
  readonly retentionPending: number;
  readonly documentTypes: number;
  readonly activeTypes: number;
}

const METADATA = [
  { key: "documentDate", label: "Belge tarihi", dataType: "DATE" },
  { key: "counterpartyId", label: "Karşı taraf", dataType: "REFERENCE" },
  { key: "amount", label: "Tutar", dataType: "DECIMAL" },
  { key: "currency", label: "Para birimi (ISO 4217)", dataType: "TEXT" },
  { key: "parentDocumentId", label: "Ana belge", dataType: "REFERENCE" },
] as const;

/** Saklama dosyasını doğrular. Geçersiz değer → açık hata (sessiz düzeltme yok). */
export function loadRetentionFile(path: string): RetentionFileProfile[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { profiles?: unknown };
  if (!Array.isArray(raw.profiles)) throw new Error("retention-profiles.json: 'profiles' dizisi yok");
  const seen = new Set<string>();
  return raw.profiles.map((p, i) => {
    const r = p as Record<string, unknown>;
    const at = `profiles[${String(i)}]`;
    if (typeof r.code !== "string" || r.code.length === 0) throw new Error(`${at}.code zorunlu`);
    if (seen.has(r.code)) throw new Error(`${at}.code tekrar ediyor: ${r.code}`);
    seen.add(r.code);
    if (typeof r.name !== "string") throw new Error(`${at}.name zorunlu`);
    const startEvent = r.startEvent ?? null;
    const disposalMethod = r.disposalMethod ?? null;
    const rawDuration: unknown = r.durationValue ?? null;
    const durationUnit = r.durationUnit ?? null;
    if (startEvent !== null && !(START_EVENTS as readonly unknown[]).includes(startEvent)) throw new Error(`${at}.startEvent geçersiz`);
    if (disposalMethod !== null && !(DISPOSAL as readonly unknown[]).includes(disposalMethod)) throw new Error(`${at}.disposalMethod geçersiz`);
    if (durationUnit !== null && !(UNITS as readonly unknown[]).includes(durationUnit)) throw new Error(`${at}.durationUnit geçersiz`);
    if (rawDuration !== null && (typeof rawDuration !== "number" || !Number.isInteger(rawDuration) || rawDuration < 1)) {
      throw new Error(`${at}.durationValue pozitif tam sayı olmalıdır`);
    }
    const durationValue: number | null = rawDuration;
    if ((durationValue === null) !== (durationUnit === null)) throw new Error(`${at}: durationValue ve durationUnit birlikte girilmelidir`);
    if (r.verifiedByLegal === true && (startEvent === null || disposalMethod === null)) {
      throw new Error(`${at}: hukuk onaylı profilde startEvent ve disposalMethod zorunludur`);
    }
    return {
      code: r.code,
      name: r.name,
      startEvent: startEvent as string | null,
      durationValue,
      durationUnit: durationUnit as string | null,
      disposalMethod: disposalMethod as string | null,
      verifiedByLegal: r.verifiedByLegal === true,
      basisNote: typeof r.basisNote === "string" ? r.basisNote : null,
    };
  });
}

export async function seedCatalog(prisma: PrismaClient, retentionFile: string): Promise<SeedReport> {
  for (const code of PERMISSION_CODES) {
    await prisma.permission.upsert({ where: { code }, update: {}, create: { code, description: code } });
  }
  const perms = await prisma.permission.findMany({ select: { id: true, code: true } });
  const permId = new Map(perms.map((p) => [p.code, p.id]));

  for (const t of ROLE_TEMPLATES) {
    const role = await prisma.role.upsert({ where: { code: t.code }, update: {}, create: { code: t.code, name: t.name, isSystemTemplate: true } });
    for (const code of t.permissions) {
      const pid = permId.get(code);
      if (!pid) throw new Error(`Tanımsız izin: ${code}`);
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: pid } },
        update: {},
        create: { roleId: role.id, permissionId: pid },
      });
    }
  }

  for (const m of METADATA) {
    await prisma.metadataDefinition.upsert({
      where: { key: m.key },
      update: {},
      create: { key: m.key, label: m.label, dataType: m.dataType, isSearchable: true, isActive: true },
    });
  }

  const profiles = loadRetentionFile(retentionFile);
  for (const p of profiles) {
    const data = {
      startEvent: p.startEvent as RetentionStartEvent | null,
      durationValue: p.durationValue,
      durationUnit: p.durationUnit as RetentionUnit | null,
      disposalMethod: p.disposalMethod as DisposalMethod | null,
      verifiedByLegal: p.verifiedByLegal,
      basisNote: p.basisNote ?? (p.durationValue === null ? "Politika bekliyor: süre ve başlangıç olayı kurum tarafından girilecek. Otomatik imha kapalı." : null),
      isActive: true,
    };
    await prisma.retentionProfile.upsert({
      where: { code: p.code },
      update: data,
      create: { code: p.code, effectiveFrom: new Date(), ...data },
    });
  }

  let activeTypes = 0;
  for (const t of BASE_DOCUMENT_TYPES) {
    const profile = t.retentionProfileRef ? await prisma.retentionProfile.findUnique({ where: { code: t.retentionProfileRef } }) : null;
    const active = profile !== null;
    if (active) activeTypes++;
    await prisma.documentType.upsert({
      where: { code: t.code },
      update: { retentionProfileId: profile?.id ?? null, isActive: active },
      create: {
        code: t.code,
        name: t.name,
        defaultConfidentiality: t.minConfidentiality,
        requiredMetadataKeys: t.requiredMetadata.filter((k) => k !== "title"),
        ocrRequired: t.ocrRequired,
        retentionProfileId: profile?.id ?? null,
        isSystemCatalog: true,
        isActive: active,
      },
    });
  }

  return {
    permissions: PERMISSION_CODES.length,
    roles: ROLE_TEMPLATES.length,
    metadataDefinitions: METADATA.length,
    retentionProfiles: profiles.length,
    retentionPending: profiles.filter((p) => !p.verifiedByLegal).length,
    documentTypes: BASE_DOCUMENT_TYPES.length,
    activeTypes,
  };
}
