// Denetçi kanıt paketi (Faz 4, madde 6): zaman aralığı + olay + sürüm + onay izi + bekletme + imha izi + checksum.
// Kapsam: yalnızca denetçinin GÖRDÜĞÜ belgeler (görünürlük filtresi). Belge dışı sistem olayları yalnızca
// kapsamsız (unscoped) audit.export yetkisi olanlara dahildir. Dışa aktarma da denetime yazılır.
import { createHash } from "node:crypto";
import { authorize, type ActorContext } from "@ekos/core";
import { Prisma, type PrismaClient } from "@prisma/client";
import { verifyAuditTable } from "../audit.js";
import { documentVisibilitySql } from "../documents/visibility.js";
import { DomainError } from "../documents/shared.js";
import { recordDenied } from "./common.js";
import { appendAudit } from "../audit.js";

const MAX_RANGE_DAYS = 366;
const SCHEMA = "EKOS_EVIDENCE_PACK_V1";

function hasActiveAuditExport(actor: ActorContext, now: Date): boolean {
  return actor.memberships.some(
    (m) =>
      m.permissions.includes("audit.export") &&
      !m.revokedAt &&
      (!m.validFrom || m.validFrom.getTime() <= now.getTime()) &&
      (!m.validUntil || m.validUntil.getTime() > now.getTime()),
  );
}

/** JSON'a güvenli dönüşüm: BigInt → string, Date → ISO. Anahtar sırası sabittir (checksum kararlılığı). */
function toJsonSafe(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    const obj = value as Record<string, unknown>;
    for (const k of Object.keys(obj).sort()) out[k] = toJsonSafe(obj[k]);
    return out;
  }
  return value;
}

/** Kanıt paketi checksum'u: sabit anahtar sırası JSON'unun SHA-256 özeti. Denetçi aynı yöntemle yeniden hesaplar. */
export function evidencePackSha256(body: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(toJsonSafe(body))).digest("hex");
}

/** Dışa aktarılmış bir paketin bütünlüğünü doğrular (sha256 alanı hariç gövde yeniden özetlenir). */
export function verifyEvidencePack(pack: Record<string, unknown>): boolean {
  const { sha256, ...body } = pack;
  return typeof sha256 === "string" && evidencePackSha256(body) === sha256;
}

export async function buildEvidencePack(
  prisma: PrismaClient,
  input: { actor: ActorContext; now: Date; correlationId: string; from: string; to: string; departmentId?: string | null; documentId?: string | null },
): Promise<{ pack: Record<string, unknown>; sha256: string }> {
  if (input.actor.status !== "ACTIVE" || !hasActiveAuditExport(input.actor, input.now)) {
    await recordDenied(prisma, { actorId: input.actor.userId, eventType: "EVIDENCE_PACK_DENIED", targetType: "AUDIT_EXPORT", targetId: null, reason: "NO_AUDIT_EXPORT", correlationId: input.correlationId });
    throw new DomainError("FORBIDDEN", "Denetim dışa aktarma yetkiniz yok");
  }
  const systemLevel = authorize({ actor: input.actor, permission: "audit.export", now: input.now }).allowed;

  const fromDate = new Date(`${input.from}T00:00:00+03:00`);
  const toDate = new Date(`${input.to}T23:59:59.999+03:00`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) throw new DomainError("RANGE_INVALID", "Tarih aralığı geçersiz");
  if ((toDate.getTime() - fromDate.getTime()) / 86_400_000 > MAX_RANGE_DAYS) throw new DomainError("RANGE_INVALID", `En fazla ${String(MAX_RANGE_DAYS)} günlük aralık dışa aktarılabilir`);

  const deptClause = input.departmentId ? Prisma.sql`AND d."departmentId" = ${input.departmentId}::uuid` : Prisma.empty;
  const docClause = input.documentId ? Prisma.sql`AND d."id" = ${input.documentId}::uuid` : Prisma.empty;
  const visibleRows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT d."id" FROM "Document" d WHERE ${documentVisibilitySql(input.actor, input.now)} ${deptClause} ${docClause}`;
  const visibleIds = new Set(visibleRows.map((r) => r.id));
  const scopedFilter = !!(input.departmentId || input.documentId);

  const rawEvents = await prisma.auditEvent.findMany({
    where: { occurredAt: { gte: fromDate, lte: toDate } },
    orderBy: { sequence: "asc" },
  });
  const events = rawEvents.filter((e) => {
    if (e.targetType === "DOCUMENT") return e.targetId !== null && visibleIds.has(e.targetId);
    return systemLevel && !scopedFilter;
  });

  const docIds = [...visibleIds];
  const docs = docIds.length
    ? await prisma.document.findMany({
        where: { id: { in: docIds } },
        select: { id: true, number: true, title: true, generalStatus: true, contractStatus: true, lifecycleProfile: true, ingestStatus: true, departmentId: true, createdAt: true, legalHoldActive: true },
        orderBy: { number: "asc" },
      })
    : [];
  const versions = docIds.length
    ? await prisma.documentVersion.findMany({
        where: { documentId: { in: docIds } },
        select: { documentId: true, versionNumber: true, sha256: true, isSigned: true, isReadOnly: true, createdAt: true, fileObjectId: true },
        orderBy: [{ documentId: "asc" }, { versionNumber: "asc" }],
      })
    : [];
  const contracts = docIds.length ? await prisma.contractRecord.findMany({ where: { documentId: { in: docIds } }, select: { id: true, documentId: true } }) : [];
  const contractIds = contracts.map((c) => c.id);
  const workflows = contractIds.length
    ? await prisma.workflowInstance.findMany({
        where: { subjectType: "CONTRACT", subjectId: { in: contractIds } },
        include: { steps: { include: { tasks: { include: { decision: true } } } } },
        orderBy: { startedAt: "asc" },
      })
    : [];
  const reviews = docIds.length
    ? await prisma.dispositionReview.findMany({
        where: { documentId: { in: docIds } },
        include: { decisions: { orderBy: { decidedAt: "asc" } }, manifest: true },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const holds = docIds.length
    ? await prisma.legalHold.findMany({ where: { documentId: { in: docIds } }, orderBy: { placedAt: "asc" } })
    : [];

  const chain = await verifyAuditTable(prisma);

  const body = {
    schema: SCHEMA,
    generatedAt: input.now.toISOString(),
    generatedBy: input.actor.userId,
    correlationId: input.correlationId,
    range: { from: input.from, to: input.to, timezone: "Europe/Istanbul" },
    filters: { departmentId: input.departmentId ?? null, documentId: input.documentId ?? null },
    scope: { documentsVisibleToExporter: docIds.length, systemEventsIncluded: systemLevel && !scopedFilter },
    auditChainVerification: chain.ok ? { ok: true, checked: chain.checked } : { ok: false, reason: chain.reason, sequence: chain.sequence.toString() },
    counts: { events: events.length, documents: docs.length, versions: versions.length, contracts: contracts.length, workflows: workflows.length, reviews: reviews.length, holds: holds.length },
    events: events.map((e) => ({
      sequence: e.sequence, occurredAt: e.occurredAt, actorType: e.actorType, actorId: e.actorId, eventType: e.eventType,
      targetType: e.targetType, targetId: e.targetId, targetVersion: e.targetVersion, outcome: e.outcome, reason: e.reason,
      correlationId: e.correlationId, requestId: e.requestId, beforeSummary: e.beforeSummary, afterSummary: e.afterSummary,
      prevHash: e.prevHash, hash: e.hash,
    })),
    documents: docs,
    versions,
    approvals: workflows.map((w) => ({
      instanceId: w.id, subjectId: w.subjectId, status: w.status, definitionVersionId: w.definitionVersionId,
      steps: w.steps.map((s) => ({
        orderIndex: s.orderIndex, status: s.status,
        tasks: s.tasks.map((t) => ({ taskId: t.id, assigneeId: t.assigneeId, status: t.status, decision: t.decision ? { decision: t.decision.decision, actorId: t.decision.actorId, decidedAt: t.decision.decidedAt, reason: t.decision.reason } : null })),
      })),
    })),
    dispositions: reviews.map((r) => ({
      reviewId: r.id, documentId: r.documentId, status: r.status, retentionDueAt: r.retentionDueAt, blockedReason: r.blockedReason,
      decisions: r.decisions.map((d) => ({ role: d.role, actorId: d.actorId, decision: d.decision, decidedAt: d.decidedAt, reason: d.reason })),
      manifest: r.manifest ? { manifestSha256: r.manifest.manifestSha256, executedAt: r.manifest.executedAt, policyVersionId: r.manifest.policyVersionId, physicalEvidenceRef: r.manifest.physicalEvidenceRef, body: r.manifest.manifest } : null,
    })),
    legalHolds: holds.map((h) => ({ holdId: h.id, documentId: h.documentId, placedAt: h.placedAt, placedById: h.placedById, releasedAt: h.releasedAt, releasedById: h.releasedById, reason: h.reason, releaseReason: h.releaseReason, scopeNote: h.scopeNote })),
  };
  const sha256 = evidencePackSha256(body);
  const pack = { ...body, sha256 };

  await prisma.$transaction((tx) =>
    appendAudit(tx, {
      actorType: "USER", actorId: input.actor.userId, eventType: "EVIDENCE_PACK_EXPORTED", targetType: "AUDIT_EXPORT", targetId: null,
      outcome: "SUCCESS", correlationId: input.correlationId,
      afterSummary: { sha256, from: input.from, to: input.to, counts: body.counts, systemEventsIncluded: body.scope.systemEventsIncluded },
    }),
  );
  return { pack, sha256 };
}
