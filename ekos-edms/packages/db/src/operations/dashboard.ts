// Genel Bakış (Faz 5, madde 3). YALNIZCA gerçek veritabanı sayımları. Sahte değer, örnek grafik yoktur.
// Tüm belge-bağlantılı metrikler documentVisibilitySql ile yetki filtrelidir (sorgu içinde, sonradan süzme yok).
// Yetkisi olmayan bölüm "accessible: false" döner (sıfır sayı ile "veri yok" karıştırılmaz).
import type { PrismaClient } from "@prisma/client";
import { authorize, type ActorContext } from "@ekos/core";
import { istanbulDate } from "../governance/common.js";
import { documentVisibilitySql } from "../documents/visibility.js";
import { listMyTasks, type TaskRow } from "./tasks.js";
import { addDays, subtractPeriod } from "./reminders.js";

const isActive = (m: { validFrom?: Date | null; validUntil?: Date | null; revokedAt?: Date | null }, now: Date) =>
  !m.revokedAt && (!m.validFrom || m.validFrom <= now) && (!m.validUntil || m.validUntil > now);

/** Aktif bir üyelik bu izni taşıyor mu? (yalnız izin varlığı; kapsam belge düzeyinde uygulanır) */
export function hasAnyGrant(actor: ActorContext, permission: string, now: Date): boolean {
  return actor.status === "ACTIVE" && actor.memberships.some((m) => isActive(m, now) && m.permissions.includes(permission));
}

export interface DashboardCounts {
  readonly contractsVisible: number;
  readonly contractsActive: number;
  readonly contractsExpired: number;
  readonly endingWithin90: number;
  readonly noticeWithin30: number;
  readonly guaranteesWithin90: number;
  readonly insuranceWithin90: number;
  readonly obligationsOverdue: number;
  readonly obligationsWithin30: number;
  readonly openApprovalsMine: number;
  readonly openApprovalsMineOverdue: number;
  readonly openApprovalsTeam: number;
  readonly metadataGapDocuments: number;
  readonly ownerlessDocuments: number;
  readonly retentionGapDocuments: number;
}

export interface DashboardView {
  readonly generatedAt: string;
  readonly today: string;
  /** Bölüm erişimi. myTasks ve operations her zaman (yalnız kendi kayıtları); diğerleri izne bağlı. */
  readonly accessible: { documents: boolean; teamApprovals: boolean; myTasks: true; operations: true; queues: boolean; auditGlobal: boolean };
  readonly counts: DashboardCounts;
  readonly mySla: TaskRow[];
  readonly failedQueues: { total: number; recent: { id: string; queue: string; name: string; status: string; lastError: string | null; updatedAt: Date }[] } | null;
  readonly recentOperations: { id: string; eventType: string; outcome: string; targetType: string; occurredAt: Date }[];
  readonly isEmpty: boolean;
}

export async function getDashboard(prisma: PrismaClient, input: { actor: ActorContext; now: Date }): Promise<DashboardView> {
  const { actor, now } = input;
  const today = istanbulDate(now);
  const t0 = new Date(`${today}T00:00:00Z`);
  const d90 = new Date(`${addDays(today, 90)}T00:00:00Z`);
  const d30 = new Date(`${addDays(today, 30)}T00:00:00Z`);
  const vis = documentVisibilitySql(actor, now);
  const docsOk = hasAnyGrant(actor, "document.list", now);
  const approvalsOk = hasAnyGrant(actor, "document.approve", now);
  // Kurum geneli yetkiler: yalnız kapsamsız (global) üyelik yeterlidir.
  const queuesOk = authorize({ actor, permission: "config.manage", now }).allowed;
  const auditGlobal = authorize({ actor, permission: "audit.export", now }).allowed;

  const zero: DashboardCounts = {
    contractsVisible: 0, contractsActive: 0, contractsExpired: 0, endingWithin90: 0, noticeWithin30: 0, guaranteesWithin90: 0,
    insuranceWithin90: 0, obligationsOverdue: 0, obligationsWithin30: 0, openApprovalsMine: 0, openApprovalsMineOverdue: 0,
    openApprovalsTeam: 0, metadataGapDocuments: 0, ownerlessDocuments: 0, retentionGapDocuments: 0,
  };
  const c: { -readonly [K in keyof DashboardCounts]: number } = { ...zero };

  if (docsOk) {
    const [p] = await prisma.$queryRaw<{ total: number; active: number; expired: number; ending: number }[]>`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE c."endDate" IS NULL OR c."endDate" >= ${t0}::date)::int AS active,
             count(*) FILTER (WHERE c."endDate" < ${t0}::date)::int AS expired,
             count(*) FILTER (WHERE c."endDate" >= ${t0}::date AND c."endDate" <= ${d90}::date)::int AS ending
      FROM "ContractRecord" c JOIN "Document" d ON d."id" = c."documentId"
      WHERE ${vis}`;
    c.contractsVisible = p?.total ?? 0;
    c.contractsActive = p?.active ?? 0;
    c.contractsExpired = p?.expired ?? 0;
    c.endingWithin90 = p?.ending ?? 0;

    // İhbar son tarihi: süre birimi takvim günü/ayı; JS aritmetiği ile reminders.ts ile AYNI kural.
    const noticeCandidates = await prisma.$queryRaw<{ endDate: Date; noticePeriodValue: number; noticePeriodUnit: string }[]>`
      SELECT c."endDate", c."noticePeriodValue", c."noticePeriodUnit"::text AS "noticePeriodUnit"
      FROM "ContractRecord" c JOIN "Document" d ON d."id" = c."documentId"
      WHERE ${vis} AND c."endDate" IS NOT NULL AND c."noticePeriodValue" IS NOT NULL AND c."endDate" >= ${t0}::date
        AND c."endDate" <= ${new Date(`${addDays(today, 400)}T00:00:00Z`)}::date`;
    c.noticeWithin30 = noticeCandidates.filter((r) => {
      const end = r.endDate.toISOString().slice(0, 10);
      const notice = subtractPeriod(end, r.noticePeriodValue, r.noticePeriodUnit === "CALENDAR_MONTHS" ? "CALENDAR_MONTHS" : "CALENDAR_DAYS");
      return notice >= today && notice <= addDays(today, 30);
    }).length;

    const [g] = await prisma.$queryRaw<{ g90: number; ins90: number }[]>`
      SELECT count(*)::int AS "g90", count(*) FILTER (WHERE g."guaranteeType" = 'INSURANCE_POLICY')::int AS "ins90"
      FROM "Guarantee" g JOIN "ContractRecord" c ON c."id" = g."contractId" JOIN "Document" d ON d."id" = c."documentId"
      WHERE ${vis} AND g."returnedAt" IS NULL AND g."expiresAt" >= ${t0}::date AND g."expiresAt" <= ${d90}::date`;
    c.guaranteesWithin90 = g?.g90 ?? 0;
    c.insuranceWithin90 = g?.ins90 ?? 0;

    const [o] = await prisma.$queryRaw<{ overdue: number; soon: number }[]>`
      SELECT count(*) FILTER (WHERE o."dueDate" < ${t0}::date)::int AS overdue,
             count(*) FILTER (WHERE o."dueDate" >= ${t0}::date AND o."dueDate" <= ${d30}::date)::int AS soon
      FROM "Obligation" o JOIN "ContractRecord" c ON c."id" = o."contractId" JOIN "Document" d ON d."id" = c."documentId"
      WHERE ${vis} AND o."status" = 'OPEN' AND o."dueDate" IS NOT NULL`;
    c.obligationsOverdue = o?.overdue ?? 0;
    c.obligationsWithin30 = o?.soon ?? 0;

    const [m] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM "Document" d JOIN "DocumentType" t ON t."id" = d."typeId"
      WHERE ${vis} AND cardinality(t."requiredMetadataKeys") > 0
        AND EXISTS (SELECT 1 FROM unnest(t."requiredMetadataKeys") k
                    WHERE NOT EXISTS (SELECT 1 FROM "MetadataValue" mv JOIN "MetadataDefinition" md ON md."id" = mv."definitionId"
                                      WHERE mv."documentId" = d."id" AND md."key" = k
                                        AND (mv."valueText" IS NOT NULL OR mv."valueNumber" IS NOT NULL OR mv."valueDate" IS NOT NULL OR mv."valueBoolean" IS NOT NULL)))`;
    c.metadataGapDocuments = m?.n ?? 0;

    const [own] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM "Document" d JOIN "User" u ON u."id" = d."ownerId"
      WHERE ${vis} AND u."status" <> 'ACTIVE'`;
    c.ownerlessDocuments = own?.n ?? 0;

    const [ret] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM "Document" d WHERE ${vis} AND d."retentionProfileId" IS NULL`;
    c.retentionGapDocuments = ret?.n ?? 0;
  }

  const mySla = await listMyTasks(prisma, { actor, now });
  c.openApprovalsMine = mySla.length;
  c.openApprovalsMineOverdue = mySla.filter((t) => t.sla === "OVERDUE").length;

  if (approvalsOk) {
    const [team] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM "ApprovalTask" t
      JOIN "WorkflowStep" s ON s."id" = t."stepId" JOIN "WorkflowInstance" i ON i."id" = s."instanceId"
      JOIN "ContractRecord" c ON c."id" = i."subjectId" JOIN "Document" d ON d."id" = c."documentId"
      WHERE t."status" = 'PENDING' AND i."subjectType" = 'CONTRACT' AND ${vis}`;
    c.openApprovalsTeam = team?.n ?? 0;
  }

  let failedQueues: DashboardView["failedQueues"] = null;
  if (queuesOk) {
    const total = await prisma.backgroundJob.count({ where: { status: { in: ["FAILED", "DEAD"] } } });
    const recent = await prisma.backgroundJob.findMany({
      where: { status: { in: ["FAILED", "DEAD"] } },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: { id: true, queue: true, name: true, status: true, lastError: true, updatedAt: true },
    });
    failedQueues = { total, recent };
  }

  const ops = await prisma.auditEvent.findMany({
    where: auditGlobal ? {} : { actorId: actor.userId },
    orderBy: { occurredAt: "desc" },
    take: 10,
    select: { id: true, eventType: true, outcome: true, targetType: true, occurredAt: true },
  });

  const isEmpty = Object.values(c).every((v) => v === 0) && (failedQueues?.total ?? 0) === 0 && ops.length === 0;
  return {
    generatedAt: now.toISOString(),
    today,
    accessible: { documents: docsOk, teamApprovals: approvalsOk, myTasks: true, operations: true, queues: queuesOk, auditGlobal },
    counts: c,
    mySla,
    failedQueues,
    recentOperations: ops.map((o) => ({ id: o.id, eventType: o.eventType, outcome: o.outcome, targetType: o.targetType, occurredAt: o.occurredAt })),
    isEmpty,
  };
}


