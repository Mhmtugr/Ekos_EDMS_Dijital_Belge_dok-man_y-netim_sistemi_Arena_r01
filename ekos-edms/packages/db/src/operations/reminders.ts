// Hatırlatma motoru (Faz 5, madde 1).
// - Kaynak tarihleri: sözleşme bitişi, ihbar son tarihi (bitiş − ihbar süresi), yenileme (ContractDeadline),
//   teminat/sigorta bitişi, açık yükümlülük vadesi, bekleyen onay görevi SLA'sı.
// - Her (konu, tür, ofset, tarih) EN FAZLA BİR KEZ üretilir (ScheduledEvent benzersiz anahtarı → idempotent).
// - Tarih değişince eski SCHEDULED olaylar CANCELLED olur, yenileri üretilir.
// - Tetiklenme: fireDate = tarih − ofset ≤ bugün ise bildirim üretilir. Birden çok eşik aynı anda geçmişse
//   (ör. kurulumdan sonra) yalnızca EN YAKIN eşik bildirilir; diğerleri "bastırıldı" (CANCELLED).
// - Tarihi geçmiş kayıtlar hatırlatılmaz; geciken işler panoda "geciken" olarak görünür.
import type { PrismaClient } from "@prisma/client";
import { uuidv7, type ActorContext } from "@ekos/core";
import { appendAudit } from "../audit.js";
import { istanbulDate, requireGlobal } from "../governance/common.js";
import { SETTING_KEYS, getCurrentSetting, validateOffsets } from "./settings.js";
import { createNotifications, globalPermissionHolders, type NotificationInput } from "./notifications.js";

export const DEFAULT_REMINDER_OFFSETS: readonly number[] = [90, 60, 30, 15, 7, 1];

export const SUBJECT = {
  CONTRACT: "CONTRACT",
  CONTRACT_DEADLINE: "CONTRACT_DEADLINE",
  GUARANTEE: "GUARANTEE",
  OBLIGATION: "OBLIGATION",
  APPROVAL_TASK: "APPROVAL_TASK",
} as const;

export async function getReminderOffsets(prisma: PrismaClient): Promise<number[]> {
  const v = await getCurrentSetting(prisma, SETTING_KEYS.REMINDER_OFFSETS);
  const offsets = v ? validateOffsets(v.offsets) : null;
  return offsets ?? [...DEFAULT_REMINDER_OFFSETS];
}

// ---- Tarih aritmetiği (yalnız takvim günü; saat dilimi karışmaz) ----
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function subtractPeriod(day: string, value: number, unit: "CALENDAR_DAYS" | "CALENDAR_MONTHS"): string {
  if (unit === "CALENDAR_DAYS") return addDays(day, -value);
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - value);
  return d.toISOString().slice(0, 10);
}
const dayOf = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);

export interface DesiredEvent {
  readonly subjectType: string;
  readonly subjectId: string;
  readonly deadlineType: string;
  readonly deadlineDate: string;
  readonly label: string;
}

/** Kaynak tablolardan istenen olay kümesi (ham; ofset uygulanmamış). Tarihi geçmişler dahil edilmez. */
export async function collectDesiredEvents(prisma: PrismaClient, today: string): Promise<DesiredEvent[]> {
  const out: DesiredEvent[] = [];
  const contracts = await prisma.contractRecord.findMany({
    where: { OR: [{ endDate: { gte: new Date(`${today}T00:00:00Z`) } }, { endDate: null }] },
    select: { id: true, title: true, endDate: true, noticePeriodValue: true, noticePeriodUnit: true },
  });
  for (const c of contracts) {
    const end = dayOf(c.endDate);
    if (end && end >= today) {
      out.push({ subjectType: SUBJECT.CONTRACT, subjectId: c.id, deadlineType: "CONTRACT_END", deadlineDate: end, label: `Sözleşme bitişi: ${c.title}` });
      if (c.noticePeriodValue && c.noticePeriodUnit) {
        const notice = subtractPeriod(end, c.noticePeriodValue, c.noticePeriodUnit);
        if (notice >= today) out.push({ subjectType: SUBJECT.CONTRACT, subjectId: c.id, deadlineType: "NOTICE_DEADLINE", deadlineDate: notice, label: `İhbar son tarihi: ${c.title}` });
      }
    }
  }
  const rows = await prisma.contractDeadline.findMany({
    where: { deadlineDate: { gte: new Date(`${today}T00:00:00Z`) } },
    select: { id: true, deadlineType: true, deadlineDate: true, contract: { select: { title: true } } },
  });
  for (const r of rows) {
    const day = dayOf(r.deadlineDate);
    if (day) out.push({ subjectType: SUBJECT.CONTRACT_DEADLINE, subjectId: r.id, deadlineType: r.deadlineType, deadlineDate: day, label: `${r.deadlineType}: ${r.contract.title}` });
  }
  const gs = await prisma.guarantee.findMany({
    where: { returnedAt: null, expiresAt: { gte: new Date(`${today}T00:00:00Z`) } },
    select: { id: true, guaranteeType: true, expiresAt: true, contract: { select: { title: true } } },
  });
  for (const g of gs) {
    const day = dayOf(g.expiresAt);
    if (!day) continue;
    const type = g.guaranteeType === "INSURANCE_POLICY" ? "INSURANCE_EXPIRY" : "GUARANTEE_EXPIRY";
    out.push({ subjectType: SUBJECT.GUARANTEE, subjectId: g.id, deadlineType: type, deadlineDate: day, label: `${type === "INSURANCE_EXPIRY" ? "Sigorta" : "Teminat"} bitişi: ${g.contract.title}` });
  }
  const obs = await prisma.obligation.findMany({
    where: { status: "OPEN", dueDate: { gte: new Date(`${today}T00:00:00Z`) } },
    select: { id: true, description: true, dueDate: true },
  });
  for (const o of obs) {
    const day = dayOf(o.dueDate);
    if (day) out.push({ subjectType: SUBJECT.OBLIGATION, subjectId: o.id, deadlineType: "OBLIGATION_DUE", deadlineDate: day, label: `Yükümlülük vadesi: ${o.description.slice(0, 120)}` });
  }
  const tasks = await prisma.approvalTask.findMany({
    where: { status: "PENDING", dueAt: { not: null } },
    select: { id: true, dueAt: true },
  });
  for (const t of tasks) {
    const day = t.dueAt ? istanbulDate(t.dueAt) : null;
    if (day && day >= today) out.push({ subjectType: SUBJECT.APPROVAL_TASK, subjectId: t.id, deadlineType: "APPROVAL_TASK", deadlineDate: day, label: "Onay görevi son tarihi" });
  }
  return out;
}

const keyOf = (e: { subjectType: string; subjectId: string; deadlineType: string; offsetDays?: number; deadlineDate: string }, withOffset: boolean) =>
  `${e.subjectType}|${e.subjectId}|${e.deadlineType}|${withOffset ? String(e.offsetDays) : ""}|${e.deadlineDate}`;

export interface SyncSummary { readonly created: number; readonly cancelled: number; readonly desired: number }

/** Olayları kaynakla eşitler (idempotent). İkinci çalıştırma hiçbir şey değiştirmez. */
export async function syncScheduledEvents(prisma: PrismaClient, input: { now: Date; correlationId: string }): Promise<SyncSummary> {
  const today = istanbulDate(input.now);
  const offsets = await getReminderOffsets(prisma);
  const sources = await collectDesiredEvents(prisma, today);
  const desired = new Map<string, { subjectType: string; subjectId: string; deadlineType: string; offsetDays: number; deadlineDate: string }>();
  for (const s of sources) {
    for (const off of offsets) {
      const e = { subjectType: s.subjectType, subjectId: s.subjectId, deadlineType: s.deadlineType, offsetDays: off, deadlineDate: s.deadlineDate };
      desired.set(keyOf(e, true), e);
    }
  }
  return prisma.$transaction(async (tx) => {
    const scheduled = await tx.scheduledEvent.findMany({ where: { status: "SCHEDULED" } });
    const existing = new Set(scheduled.map((e) => keyOf({ ...e, deadlineDate: e.deadlineDate.toISOString().slice(0, 10) }, true)));
    const staleIds = scheduled
      .filter((e) => !desired.has(keyOf({ ...e, deadlineDate: e.deadlineDate.toISOString().slice(0, 10) }, true)))
      .map((e) => e.id);
    let cancelled = 0;
    if (staleIds.length > 0) {
      cancelled = (await tx.scheduledEvent.updateMany({ where: { id: { in: staleIds } }, data: { status: "CANCELLED" } })).count;
    }
    const toCreate = [...desired.entries()]
      .filter(([k]) => !existing.has(k))
      .map(([, e]) => ({
        id: uuidv7(),
        subjectType: e.subjectType,
        subjectId: e.subjectId,
        deadlineType: e.deadlineType,
        offsetDays: e.offsetDays,
        deadlineDate: new Date(`${e.deadlineDate}T00:00:00Z`),
        status: "SCHEDULED" as const,
      }));
    let created = 0;
    if (toCreate.length > 0) {
      created = (await tx.scheduledEvent.createMany({ data: toCreate, skipDuplicates: true })).count;
    }
    if (created > 0 || cancelled > 0) {
      await appendAudit(tx, {
        actorType: "WORKER", actorId: null, eventType: "REMINDER_SYNC", targetType: "SCHEDULED_EVENT", targetId: null,
        outcome: "SUCCESS", correlationId: input.correlationId, afterSummary: { created, cancelled, desired: desired.size },
      });
    }
    return { created, cancelled, desired: desired.size };
  });
}

/** Alıcılar: konunun sorumluları (aktif hesaplar). Boşsa belge sahibi; o da yoksa boş döner. */
async function recipientsFor(prisma: PrismaClient, subjectType: string, subjectId: string): Promise<{ ids: string[]; label: string }> {
  let contract: { contractManagerId: string | null; businessOwnerId: string | null; requesterId: string | null; documentId: string; title: string } | null = null;
  let ids: (string | null)[] = [];
  let label = "";
  if (subjectType === SUBJECT.CONTRACT || subjectType === SUBJECT.CONTRACT_DEADLINE || subjectType === SUBJECT.GUARANTEE) {
    let contractId = subjectId;
    if (subjectType === SUBJECT.CONTRACT_DEADLINE) contractId = (await prisma.contractDeadline.findUniqueOrThrow({ where: { id: subjectId }, select: { contractId: true } })).contractId;
    if (subjectType === SUBJECT.GUARANTEE) contractId = (await prisma.guarantee.findUniqueOrThrow({ where: { id: subjectId }, select: { contractId: true } })).contractId;
    contract = await prisma.contractRecord.findUniqueOrThrow({
      where: { id: contractId },
      select: { contractManagerId: true, businessOwnerId: true, requesterId: true, documentId: true, title: true },
    });
    ids = [contract.contractManagerId, contract.businessOwnerId, contract.requesterId];
    label = contract.title;
  } else if (subjectType === SUBJECT.OBLIGATION) {
    const o = await prisma.obligation.findUniqueOrThrow({ where: { id: subjectId }, select: { responsibleUserId: true, contractId: true, description: true } });
    const c = await prisma.contractRecord.findUniqueOrThrow({ where: { id: o.contractId }, select: { contractManagerId: true, businessOwnerId: true, documentId: true, title: true } });
    ids = [o.responsibleUserId, c.contractManagerId, c.businessOwnerId];
    label = o.description.slice(0, 120);
    contract = { contractManagerId: null, businessOwnerId: null, requesterId: null, documentId: c.documentId, title: c.title };
  } else if (subjectType === SUBJECT.APPROVAL_TASK) {
    const t = await prisma.approvalTask.findUniqueOrThrow({ where: { id: subjectId }, select: { assigneeId: true } });
    ids = [t.assigneeId];
    label = "Onay görevi";
  }
  const unique = [...new Set(ids.filter((x): x is string => typeof x === "string"))];
  const active = unique.length
    ? (await prisma.user.findMany({ where: { id: { in: unique }, status: "ACTIVE" }, select: { id: true } })).map((u) => u.id)
    : [];
  if (active.length === 0 && contract) {
    const doc = await prisma.document.findUnique({ where: { id: contract.documentId }, select: { ownerId: true } });
    if (doc) {
      const owner = await prisma.user.findFirst({ where: { id: doc.ownerId, status: "ACTIVE" }, select: { id: true } });
      if (owner) active.push(owner.id);
    }
  }
  return { ids: active, label };
}

export interface FireSummary { readonly fired: number; readonly suppressed: number; readonly notifications: number; readonly unrouted: number }

/** Tetiklenmesi gereken hatırlatmaları üretir. Yeniden çalıştırmak çift bildirim üretmez. */
export async function fireDueReminders(prisma: PrismaClient, input: { now: Date; correlationId: string }): Promise<FireSummary> {
  const today = istanbulDate(input.now);
  const offsets = await getReminderOffsets(prisma);
  const maxOffset = Math.max(...offsets);
  const horizon = new Date(`${addDays(today, maxOffset)}T00:00:00Z`);
  const candidates = await prisma.scheduledEvent.findMany({
    where: { status: "SCHEDULED", deadlineDate: { gte: new Date(`${today}T00:00:00Z`), lte: horizon } },
    orderBy: [{ deadlineDate: "asc" }, { id: "asc" }],
  });
  const groups = new Map<string, typeof candidates>();
  for (const e of candidates) {
    const k = `${e.subjectType}|${e.subjectId}|${e.deadlineType}|${e.deadlineDate.toISOString().slice(0, 10)}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  let fired = 0;
  let suppressed = 0;
  let notifications = 0;
  let unrouted = 0;

  for (const group of groups.values()) {
    const dl = group[0]?.deadlineDate.toISOString().slice(0, 10) ?? today;
    const due = group.filter((e) => addDays(dl, -e.offsetDays) <= today);
    if (due.length === 0) continue;
    // En yakın eşik kazanır (en küçük ofset); diğer geçmiş eşikler bastırılır.
    due.sort((a, b) => a.offsetDays - b.offsetDays);
    const winner = due[0];
    if (!winner) continue;
    const losers = due.slice(1).map((e) => e.id);
    const rec = await recipientsFor(prisma, winner.subjectType, winner.subjectId);
    const typeName = `REMINDER_${winner.deadlineType}`;
    const body = `${rec.label} — son tarih ${dl} (${String(Math.max(0, Math.round((new Date(`${dl}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000)))} gün kaldı)`;
    let targets = rec.ids;
    if (targets.length === 0) {
      // Alıcı yoksa asla sessiz kalmaz: yöneticilere sorumlusuz kayıt olarak düşer.
      unrouted++;
      targets = await globalPermissionHolders(prisma, "config.manage", input.now);
    }
    const items: NotificationInput[] = targets.map((userId) => ({
      userId,
      type: typeName.slice(0, 60),
      title: rec.ids.length === 0 ? `Sorumlusuz hatırlatma: ${winner.deadlineType}` : `Hatırlatma: ${winner.deadlineType}`,
      body,
      subjectType: winner.subjectType,
      subjectId: winner.subjectId,
      dedupeKey: `rem:${winner.id}:${userId}`,
    }));
    notifications += await createNotifications(prisma, items);
    await prisma.$transaction(async (tx) => {
      await tx.scheduledEvent.update({ where: { id: winner.id }, data: { status: "FIRED" } });
      if (losers.length > 0) {
        suppressed += (await tx.scheduledEvent.updateMany({ where: { id: { in: losers }, status: "SCHEDULED" }, data: { status: "CANCELLED" } })).count;
      }
    });
    fired++;
  }

  if (fired > 0 || suppressed > 0) {
    await prisma.$transaction(async (tx) => {
      await appendAudit(tx, {
        actorType: "WORKER", actorId: null, eventType: "REMINDER_FIRED", targetType: "SCHEDULED_EVENT", targetId: null,
        outcome: "SUCCESS", correlationId: input.correlationId, afterSummary: { fired, suppressed, notifications, unrouted },
      });
    });
  }
  return { fired, suppressed, notifications, unrouted };
}

/** Yönetici tetikleyici: eşitle + tetikle. Yalnızca config.manage. */
export async function runReminderCycle(
  prisma: PrismaClient,
  input: { actor: ActorContext; now: Date; correlationId: string },
): Promise<SyncSummary & FireSummary> {
  requireGlobal(input.actor, "config.manage", input.now);
  const sync = await syncScheduledEvents(prisma, { now: input.now, correlationId: input.correlationId });
  const fire = await fireDueReminders(prisma, { now: input.now, correlationId: input.correlationId });
  return { ...sync, ...fire };
}

/** Yakında gelen olaylar (UI/rapor): SCHEDULED, tarihi bugünden itibaren. */
export async function listUpcomingScheduled(prisma: PrismaClient, input: { now: Date; days: number }) {
  const today = istanbulDate(input.now);
  return prisma.scheduledEvent.findMany({
    where: { status: "SCHEDULED", deadlineDate: { gte: new Date(`${today}T00:00:00Z`), lte: new Date(`${addDays(today, input.days)}T00:00:00Z`) } },
    orderBy: [{ deadlineDate: "asc" }, { id: "asc" }],
    take: 500,
  });
}

