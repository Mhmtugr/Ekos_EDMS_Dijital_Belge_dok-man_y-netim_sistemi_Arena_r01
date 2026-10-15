// Sistem ayarları (Faz 5, madde 6). Kritik ayarlar tek kişiyle değişmez: değişiklik önerilir (pending),
// AYNI yetkide FARKLI bir kullanıcı onaylar. Değer JSON'da { current, pending } olarak tutulur.
// Gizli değer ASLA saklanmaz: yalnızca secret store anahtarının ADI (örn. SMTP_URL) tutulur.
import type { Prisma} from "@prisma/client";
import { type PrismaClient } from "@prisma/client";
import { uuidv7, type ActorContext } from "@ekos/core";
import { appendAudit } from "../audit.js";
import { DomainError } from "../documents/shared.js";
import { requireGlobal } from "../governance/common.js";

export const SETTING_KEYS = {
  REMINDER_OFFSETS: "reminders.offsetDays",
  EMAIL_CHANNEL: "notifications.email",
  TEAMS_CHANNEL: "notifications.teams",
  EXPORT_POLICY: "exports.policy",
  BACKUP_POLICY: "backup.policy",
} as const;
export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

type Validated = { ok: true; value: Record<string, unknown> } | { ok: false; message: string };

const SECRET_NAME = /^[A-Z][A-Z0-9_]{2,79}$/;

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function validateOffsets(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > 12) return null;
  const out: number[] = [];
  for (const x of v) {
    if (typeof x !== "number" || !Number.isInteger(x) || x < 1 || x > 365) return null;
    if (out.includes(x)) return null;
    out.push(x);
  }
  return out.sort((a, b) => b - a);
}

export interface SettingDef {
  readonly key: SettingKey;
  readonly label: string;
  readonly critical: boolean;
  /** Ayar yapılandırılmadığında bloke edilen işlevler (Kurulum ekranı bunu açıkça gösterir). */
  readonly blocks: string;
  validate(v: unknown): Validated;
}

export const SETTING_DEFS: Record<SettingKey, SettingDef> = {
  [SETTING_KEYS.REMINDER_OFFSETS]: {
    key: SETTING_KEYS.REMINDER_OFFSETS,
    label: "Hatırlatma aralıkları (gün)",
    critical: false,
    blocks: "Yapılandırılmazsa varsayılan 90, 60, 30, 15, 7, 1 gün kullanılır.",
    validate(v) {
      const o = obj(v);
      const offsets = o ? validateOffsets(o.offsets) : null;
      return offsets ? { ok: true, value: { offsets } } : { ok: false, message: "Aralıklar 1–365 arası, benzersiz tam sayılardan oluşmalı (1–12 adet)" };
    },
  },
  [SETTING_KEYS.EMAIL_CHANNEL]: {
    key: SETTING_KEYS.EMAIL_CHANNEL,
    label: "E-posta bildirimi (SMTP)",
    critical: true,
    blocks: "E-posta teslimi yapılmaz; bildirimler yalnızca uygulama içinde görünür (durum: Yapılandırılmadı).",
    validate(v) {
      const o = obj(v);
      if (!o || typeof o.enabled !== "boolean") return { ok: false, message: "enabled (true/false) zorunlu" };
      if (typeof o.secretRef !== "string" || !SECRET_NAME.test(o.secretRef)) {
        return { ok: false, message: "secretRef: secret store anahtar adı olmalı (örn. SMTP_URL); değer girilmez" };
      }
      if (typeof o.from !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.from)) return { ok: false, message: "Gönderen e-posta adresi geçersiz" };
      return { ok: true, value: { enabled: o.enabled, secretRef: o.secretRef, from: o.from } };
    },
  },
  [SETTING_KEYS.TEAMS_CHANNEL]: {
    key: SETTING_KEYS.TEAMS_CHANNEL,
    label: "Microsoft Teams bildirimi (gelen web kancası)",
    critical: true,
    blocks: "Teams kanalına bildirim gönderilmez (durum: Yapılandırılmadı).",
    validate(v) {
      const o = obj(v);
      if (!o || typeof o.enabled !== "boolean") return { ok: false, message: "enabled (true/false) zorunlu" };
      if (typeof o.secretRef !== "string" || !SECRET_NAME.test(o.secretRef)) {
        return { ok: false, message: "secretRef: secret store anahtar adı olmalı (örn. TEAMS_WEBHOOK_URL); URL girilmez" };
      }
      return { ok: true, value: { enabled: o.enabled, secretRef: o.secretRef } };
    },
  },
  [SETTING_KEYS.EXPORT_POLICY]: {
    key: SETTING_KEYS.EXPORT_POLICY,
    label: "Dışa aktarma politikası",
    critical: true,
    blocks: "Yapılandırılmazsa dışa aktarmada varsayılan kısıt (KISITLI indirmede 1000 satır üst sınırı) uygulanır.",
    validate(v) {
      const o = obj(v);
      const cap = o?.restrictedRowCap;
      if (!o || typeof cap !== "number" || !Number.isInteger(cap) || cap < 100 || cap > 5000) {
        return { ok: false, message: "restrictedRowCap 100–5000 arası tam sayı olmalı" };
      }
      if (o.watermark !== true) return { ok: false, message: "Hassas raporlarda filigran zorunludur (watermark: true)" };
      return { ok: true, value: { restrictedRowCap: cap, watermark: true } };
    },
  },
  [SETTING_KEYS.BACKUP_POLICY]: {
    key: SETTING_KEYS.BACKUP_POLICY,
    label: "Yedekleme ve dışa aktarma politikası",
    critical: true,
    blocks: "Yedekleme sorumlusu ve sıklığı tanımlanmazsa yedekleme kanıtı üretilemez (kurum dışı).",
    validate(v) {
      const o = obj(v);
      if (!o || !["DAILY", "WEEKLY", "NONE"].includes(String(o.frequency))) return { ok: false, message: "frequency: DAILY, WEEKLY veya NONE" };
      if (typeof o.owner !== "string" || o.owner.trim().length < 3 || o.owner.length > 200) return { ok: false, message: "Sorumlu (owner) zorunlu" };
      if (typeof o.note !== "string" || o.note.length > 1000) return { ok: false, message: "Not en fazla 1000 karakter" };
      return { ok: true, value: { frequency: o.frequency, owner: o.owner.trim(), note: o.note.trim() } };
    },
  },
};

export function settingDef(key: string): SettingDef {
  const d = (SETTING_DEFS as Record<string, SettingDef | undefined>)[key];
  if (!d) throw new DomainError("NOT_FOUND", "Bilinmeyen ayar anahtarı");
  return d;
}

interface Stored {
  current: Record<string, unknown> | null;
  pending: { value: Record<string, unknown>; proposedById: string; proposedAt: string } | null;
}

function parseStored(json: Prisma.JsonValue | null | undefined): Stored {
  const o = obj(json);
  if (!o) return { current: null, pending: null };
  const p = obj(o.pending);
  return {
    current: obj(o.current),
    pending: p && obj(p.value) && typeof p.proposedById === "string" && typeof p.proposedAt === "string"
      ? { value: obj(p.value) as Record<string, unknown>, proposedById: p.proposedById, proposedAt: p.proposedAt }
      : null,
  };
}

/** Yalnızca ONAYLI (current) değer. Tanımsızsa null — çağıran varsayılan/bloke davranışını kendi seçer. */
export async function getCurrentSetting(prisma: PrismaClient, key: SettingKey): Promise<Record<string, unknown> | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  return row ? parseStored(row.valueJson).current : null;
}

export interface SettingView {
  key: SettingKey;
  label: string;
  critical: boolean;
  blocks: string;
  current: Record<string, unknown> | null;
  pending: Stored["pending"];
  status: "COMPLETED" | "REQUIRED" | "UNVERIFIED";
  rowVersion: number;
}

export async function listSettings(prisma: PrismaClient, input: { actor: ActorContext; now: Date }): Promise<SettingView[]> {
  requireGlobal(input.actor, "config.manage", input.now);
  const rows = await prisma.systemSetting.findMany();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return Object.values(SETTING_DEFS).map((d) => {
    const row = byKey.get(d.key);
    const st = row ? parseStored(row.valueJson) : { current: null, pending: null };
    const status: SettingView["status"] = st.pending ? "UNVERIFIED" : st.current ? "COMPLETED" : "REQUIRED";
    return {
      key: d.key,
      label: d.label,
      critical: d.critical,
      blocks: d.blocks,
      current: st.current,
      pending: st.pending,
      status,
      rowVersion: row?.rowVersion ?? 0,
    };
  });
}

/**
 * Ayar kaydet. Kritik: yalnızca ÖNERİ yazılır (pending); onay başka kullanıcıdan gelir.
 * expectedRowVersion: ilk kayıtta 0, sonrasında mevcut sürüm (eşleşmezse VERSION_CONFLICT).
 */
export async function saveSetting(
  prisma: PrismaClient,
  input: { actor: ActorContext; now: Date; correlationId: string; key: string; value: unknown; expectedRowVersion: number },
): Promise<{ status: "APPLIED" | "PENDING_SECOND_APPROVAL"; rowVersion: number }> {
  requireGlobal(input.actor, "config.manage", input.now);
  const def = settingDef(input.key);
  const v = def.validate(input.value);
  if (!v.ok) throw new DomainError("VALIDATION_FAILED", v.message);

  return prisma.$transaction(async (tx) => {
    const row = await tx.systemSetting.findUnique({ where: { key: def.key } });
    const currentVersion = row?.rowVersion ?? 0;
    if (currentVersion !== input.expectedRowVersion) throw new DomainError("VERSION_CONFLICT");
    const st = parseStored(row?.valueJson);
    const before = st.current;

    if (def.critical) {
      const next: Stored = { current: st.current, pending: { value: v.value, proposedById: input.actor.userId, proposedAt: input.now.toISOString() } };
      const saved = row
        ? await tx.systemSetting.update({ where: { id: row.id }, data: { valueJson: next as unknown as Prisma.InputJsonValue, status: "UNVERIFIED", rowVersion: { increment: 1 }, updatedBy: input.actor.userId } })
        : await tx.systemSetting.create({ data: { id: uuidv7(), key: def.key, valueJson: next as unknown as Prisma.InputJsonValue, status: "UNVERIFIED", createdBy: input.actor.userId, updatedBy: input.actor.userId } });
      await appendAudit(tx, {
        actorType: "USER", actorId: input.actor.userId, eventType: "SETTING_CHANGE_PROPOSED", targetType: "SYSTEM_SETTING", targetId: saved.id,
        outcome: "SUCCESS", correlationId: input.correlationId, beforeSummary: { key: def.key }, afterSummary: { key: def.key, awaitingSecondApproval: true },
      });
      return { status: "PENDING_SECOND_APPROVAL", rowVersion: saved.rowVersion };
    }

    const next: Stored = { current: v.value, pending: null };
    const saved = row
      ? await tx.systemSetting.update({ where: { id: row.id }, data: { valueJson: next as unknown as Prisma.InputJsonValue, status: "COMPLETED", rowVersion: { increment: 1 }, updatedBy: input.actor.userId } })
      : await tx.systemSetting.create({ data: { id: uuidv7(), key: def.key, valueJson: next as unknown as Prisma.InputJsonValue, status: "COMPLETED", createdBy: input.actor.userId, updatedBy: input.actor.userId } });
    await appendAudit(tx, {
      actorType: "USER", actorId: input.actor.userId, eventType: "SETTING_CHANGED", targetType: "SYSTEM_SETTING", targetId: saved.id,
      outcome: "SUCCESS", correlationId: input.correlationId, beforeSummary: { key: def.key, configured: before !== null }, afterSummary: { key: def.key, configured: true },
    });
    return { status: "APPLIED", rowVersion: saved.rowVersion };
  });
}

/** İkinci onay: öneriyi yapan DIŞINDA bir config.manage kullanıcısı uygular. */
export async function approveSettingChange(
  prisma: PrismaClient,
  input: { actor: ActorContext; now: Date; correlationId: string; key: string; expectedRowVersion: number },
): Promise<{ rowVersion: number }> {
  requireGlobal(input.actor, "config.manage", input.now);
  const def = settingDef(input.key);
  return prisma.$transaction(async (tx) => {
    const row = await tx.systemSetting.findUnique({ where: { key: def.key } });
    if (!row || row.rowVersion !== input.expectedRowVersion) throw new DomainError("VERSION_CONFLICT");
    const st = parseStored(row.valueJson);
    if (!st.pending) throw new DomainError("SETTING_STATE_INVALID", "Onay bekleyen değişiklik yok");
    if (st.pending.proposedById === input.actor.userId) {
      await appendAudit(tx, {
        actorType: "USER", actorId: input.actor.userId, eventType: "SETTING_CHANGE_APPROVED", targetType: "SYSTEM_SETTING", targetId: row.id,
        outcome: "DENIED", reason: "SECOND_APPROVER_REQUIRED", correlationId: input.correlationId, afterSummary: { key: def.key },
      });
      throw new DomainError("DECISION_DENIED", "Kritik ayarı öneren kişi aynı değişikliği onaylayamaz (ikinci onaycı gerekir)");
    }
    const next: Stored = { current: st.pending.value, pending: null };
    const saved = await tx.systemSetting.update({
      where: { id: row.id },
      data: { valueJson: next as unknown as Prisma.InputJsonValue, status: "COMPLETED", secondApproverId: input.actor.userId, rowVersion: { increment: 1 }, updatedBy: input.actor.userId },
    });
    await appendAudit(tx, {
      actorType: "USER", actorId: input.actor.userId, eventType: "SETTING_CHANGE_APPROVED", targetType: "SYSTEM_SETTING", targetId: row.id,
      outcome: "SUCCESS", correlationId: input.correlationId, beforeSummary: { key: def.key }, afterSummary: { key: def.key, proposedById: st.pending.proposedById, secondApproverId: input.actor.userId },
    });
    return { rowVersion: saved.rowVersion };
  });
}

/** Öneriyi iptal eder: öneren veya ikinci onaycı olarak config.manage kullanıcısı. */
export async function cancelSettingChange(
  prisma: PrismaClient,
  input: { actor: ActorContext; now: Date; correlationId: string; key: string; expectedRowVersion: number },
): Promise<void> {
  requireGlobal(input.actor, "config.manage", input.now);
  const def = settingDef(input.key);
  await prisma.$transaction(async (tx) => {
    const row = await tx.systemSetting.findUnique({ where: { key: def.key } });
    if (!row || row.rowVersion !== input.expectedRowVersion) throw new DomainError("VERSION_CONFLICT");
    const st = parseStored(row.valueJson);
    if (!st.pending) throw new DomainError("SETTING_STATE_INVALID", "İptal edilecek öneri yok");
    await tx.systemSetting.update({
      where: { id: row.id },
      data: { valueJson: { current: st.current, pending: null } as unknown as Prisma.InputJsonValue, status: st.current ? "COMPLETED" : "REQUIRED", rowVersion: { increment: 1 }, updatedBy: input.actor.userId },
    });
    await appendAudit(tx, {
      actorType: "USER", actorId: input.actor.userId, eventType: "SETTING_CHANGE_CANCELLED", targetType: "SYSTEM_SETTING", targetId: row.id,
      outcome: "SUCCESS", correlationId: input.correlationId, afterSummary: { key: def.key },
    });
  });
}
