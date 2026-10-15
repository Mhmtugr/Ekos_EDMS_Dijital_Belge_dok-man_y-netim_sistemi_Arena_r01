// Mali yıl sonu takvimi (kurum yapılandırması). Harita girilmeden FISCAL_YEAR_END başlangıcı çözülmez; tarih uydurulmaz.
// Yetki: config.manage (kurum geneli). Her değişiklik denetime yazılır.
import type { PrismaClient } from "@prisma/client";
import type { ActorContext } from "@ekos/core";
import { DomainError } from "../documents/shared.js";
import { appendAudit } from "../audit.js";
import { requireGlobal } from "./common.js";

/** Yıl → mali yıl sonu (YYYY-MM-DD) haritası. Servislerin varsayılan kaynağı. */
export async function loadFiscalYearMap(prisma: PrismaClient): Promise<Record<string, string>> {
  const rows = await prisma.fiscalYearEnd.findMany({ select: { year: true, endDate: true } });
  const out: Record<string, string> = {};
  for (const r of rows) out[String(r.year)] = r.endDate.toISOString().slice(0, 10);
  return out;
}

export async function listFiscalYearEnds(prisma: PrismaClient, input: { actor: ActorContext; now: Date }) {
  requireGlobal(input.actor, "config.manage", input.now);
  const rows = await prisma.fiscalYearEnd.findMany({ orderBy: { year: "desc" } });
  return rows.map((r) => ({
    year: r.year,
    endDate: r.endDate.toISOString().slice(0, 10),
    setAt: r.setAt,
    rowVersion: r.rowVersion,
  }));
}

function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Mali yıl sonunu ekler veya günceller. expectedRowVersion: yeni kayıtta null, güncellemede mevcut sürüm.
 * Yıl ile bitiş tarihinin yılı aynı olmalıdır (ör. 2025 → 2025-12-31).
 */
export async function setFiscalYearEnd(
  prisma: PrismaClient,
  input: {
    actor: ActorContext; now: Date; correlationId: string;
    year: number; endDate: string; expectedRowVersion: number | null;
  },
): Promise<{ year: number; rowVersion: number }> {
  requireGlobal(input.actor, "config.manage", input.now);
  if (!Number.isInteger(input.year) || input.year < 1900 || input.year > 2200) {
    throw new DomainError("FISCAL_YEAR_INVALID", "Yıl geçersiz");
  }
  if (!isRealDate(input.endDate) || !input.endDate.startsWith(`${String(input.year)}-`)) {
    throw new DomainError("FISCAL_YEAR_INVALID", "Mali yıl sonu tarihi seçilen yılın içinde olmalıdır");
  }
  return prisma.$transaction(async (tx) => {
    const existing = await tx.fiscalYearEnd.findUnique({ where: { year: input.year } });
    if (!existing) {
      if (input.expectedRowVersion !== null) throw new DomainError("VERSION_CONFLICT");
      await tx.fiscalYearEnd.create({
        data: { year: input.year, endDate: new Date(`${input.endDate}T00:00:00Z`), setById: input.actor.userId, rowVersion: 1 },
      });
      await appendAudit(tx, {
        actorType: "USER", actorId: input.actor.userId, eventType: "FISCAL_YEAR_END_SET", targetType: "FISCAL_YEAR",
        targetId: null, outcome: "SUCCESS", correlationId: input.correlationId,
        afterSummary: { year: input.year, endDate: input.endDate, rowVersion: 1 },
      });
      return { year: input.year, rowVersion: 1 };
    }
    if (input.expectedRowVersion !== existing.rowVersion) throw new DomainError("VERSION_CONFLICT");
    const upd = await tx.fiscalYearEnd.updateMany({
      where: { year: input.year, rowVersion: existing.rowVersion },
      data: { endDate: new Date(`${input.endDate}T00:00:00Z`), setById: input.actor.userId, setAt: input.now, rowVersion: { increment: 1 } },
    });
    if (upd.count !== 1) throw new DomainError("VERSION_CONFLICT");
    await appendAudit(tx, {
      actorType: "USER", actorId: input.actor.userId, eventType: "FISCAL_YEAR_END_SET", targetType: "FISCAL_YEAR",
      targetId: null, outcome: "SUCCESS", correlationId: input.correlationId,
      beforeSummary: { year: input.year, endDate: existing.endDate.toISOString().slice(0, 10) },
      afterSummary: { year: input.year, endDate: input.endDate, rowVersion: existing.rowVersion + 1 },
    });
    return { year: input.year, rowVersion: existing.rowVersion + 1 };
  });
}
