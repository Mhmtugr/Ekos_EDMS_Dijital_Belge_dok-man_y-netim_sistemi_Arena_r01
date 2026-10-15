// Faz 4 entegrasyon testleri (GERÇEK PostgreSQL). Saklama profili, hukuki bekletme, imha akışı,
// ayrılış ve devir, kırılma-cam süre sonu, kanıt paketi yetki sınırı ve checksum.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadActorContext } from "../actor.js";
import { createDocument } from "../documents/create.js";
import { guardDocument } from "../documents/guard.js";
import { registerUpload, scanFile } from "../documents/upload.js";
import { createContract } from "../contracts/lifecycle.js";
import { startTestDb, type TestDb } from "../testing/pg-harness.js";
import { FakeAv, MemStorage } from "../testing/fakes.js";
import { istanbulDate } from "./common.js";
import {
  assignRetentionProfile,
  createRetentionProfile,
  getRetentionStatus,
  recordRetentionTriggerEvent,
  updateRetentionProfile,
  verifyRetentionProfileByLegal,
} from "./retention.js";
import { placeLegalHold, releaseLegalHold } from "./holds.js";
import {
  decideDispositionReview,
  runDispositionWorker,
  scanDispositionCandidates,
  verifyDisposalManifest,
} from "./disposal.js";
import {
  completeOffboarding,
  getOffboardingCase,
  openOffboardingCase,
  transferOffboardingItem,
  waiveOffboardingItem,
} from "./offboarding.js";
import { approveBreakGlass, expireBreakGlassGrants, recordBreakGlassUse, requestBreakGlass } from "./breakglass.js";
import { buildEvidencePack, verifyEvidencePack } from "./evidence.js";
import type { Prisma } from "@prisma/client";

const NOW = new Date("2026-10-14T06:00:00Z");
const MIN = 60_000;
const MAX = 10 * 1024 * 1024;
const PDF = (tag: string) => new TextEncoder().encode(`%PDF-1.7\n% ${tag}\n${"x".repeat(64)}\n%%EOF`);
const EMPTY_SCOPE = { departmentIds: [], documentTypeIds: [], counterpartyIds: [], projectIds: [], updatedAt: NOW };

let db: TestDb;
let storage: MemStorage;
let deps: { prisma: TestDb["prisma"]; storage: MemStorage; av: FakeAv };
let admin: string; // global: config.manage, user.manage, breakglass.approve, audit.export (kapsamsız)
let recA: string; // inceleyen-hukuk: retention_review, legal_hold, legal_review, sorumluluk devri
let apprB: string; // profil imha onaycısı (inceleyen rolü)
let apprC: string; // profil imha onaycısı (ikinci onaycı rolü)
let plain: string; // hiçbir yetkisi yok
let auditor: string; // yalnız D1 kapsamında audit.export
let deptD1: string;
let deptD2: string;
let cpId: string;
let profV: string; // hukuken doğrulanmış profil (MANUAL_EVENT, 1 gün)
let profU: string; // doğrulanmamış profil
let seq = 0;

const cid = (p: string) => `${p}-${String(++seq)}`;
const ctx = (id: string, now: Date = NOW) => loadActorContext(db.prisma, id, now);

function must<T>(v: T | undefined | null, what: string): T {
  if (v === undefined || v === null) throw new Error(`beklenen kayıt yok: ${what}`);
  return v;
}

beforeAll(async () => {
  db = await startTestDb();
  const p = db.prisma;
  const codes = [
    "document.list", "document.view_metadata", "document.edit_metadata", "document.retention_review",
    "document.legal_hold", "document.disposal_approve", "document.approve", "contract.manage_obligations",
    "contract.legal_review", "config.manage", "user.manage", "breakglass.approve", "audit.export",
  ];
  await p.permission.createMany({ data: codes.map((code) => ({ code, description: code })) });
  const perms = await p.permission.findMany();
  const pid = (c: string) => must(perms.find((x) => x.code === c), c).id;
  const role = async (code: string, list: string[]) => {
    const r = await p.role.create({ data: { code, name: code, updatedAt: NOW } });
    for (const c of list) await p.rolePermission.create({ data: { roleId: r.id, permissionId: pid(c) } });
    return r.id;
  };
  const rOps = await role("R_OPS", ["config.manage", "user.manage", "breakglass.approve", "audit.export", "document.list", "document.view_metadata"]);
  const rRev = await role("R_REV", ["document.list", "document.view_metadata", "document.edit_metadata", "document.retention_review", "document.legal_hold", "contract.manage_obligations", "contract.legal_review"]);
  const rApp = await role("R_APP", ["document.list", "document.view_metadata", "document.retention_review", "document.disposal_approve"]);
  const rAud = await role("R_AUD", ["document.list", "document.view_metadata", "audit.export"]);

  const user = async (tag: string) =>
    (await p.user.create({ data: { email: `${tag}@t.test`, displayName: tag, updatedAt: NOW } })).id;
  admin = await user("admin");
  recA = await user("reviewer");
  apprB = await user("apprb");
  apprC = await user("apprc");
  plain = await user("plain");
  auditor = await user("auditor");

  await p.membership.create({ data: { userId: admin, roleId: rOps, ...EMPTY_SCOPE } as never });
  await p.membership.create({ data: { userId: recA, roleId: rRev, ...EMPTY_SCOPE } as never });
  await p.membership.create({ data: { userId: apprB, roleId: rApp, ...EMPTY_SCOPE } as never });
  await p.membership.create({ data: { userId: apprC, roleId: rApp, ...EMPTY_SCOPE } as never });

  deptD1 = (await p.department.create({ data: { code: "D1-T", name: "Birim 1" } })).id;
  deptD2 = (await p.department.create({ data: { code: "D2-T", name: "Birim 2" } })).id;
  await p.membership.create({ data: { userId: auditor, roleId: rAud, ...EMPTY_SCOPE, departmentIds: [deptD1] } as never });

  await p.documentType.create({ data: { code: "GENEL", name: "Genel", defaultConfidentiality: "INTERNAL", requiredMetadataKeys: [], updatedAt: NOW } as never });
  await p.documentType.create({ data: { code: "SOZLESME", name: "Sözleşme", defaultConfidentiality: "CONFIDENTIAL", requiredMetadataKeys: ["counterpartyId"], updatedAt: NOW } as never });
  await p.metadataDefinition.create({ data: { key: "counterpartyId", label: "Karşı taraf", dataType: "REFERENCE", enumValues: [] } as never });
  await p.metadataDefinition.create({ data: { key: "ozel_not", label: "Özel not", dataType: "TEXT", enumValues: [] } as never });
  await p.legalEntity.create({ data: { name: "EKOS Test A.Ş.", countryCode: "TR", updatedAt: NOW } as never });
  cpId = (await p.counterparty.create({ data: { officialName: "Test Tedarikçi Ltd.", countryCode: "TR", status: "ACTIVE", updatedAt: NOW } as never })).id;

  storage = new MemStorage();
  deps = { prisma: p, storage, av: new FakeAv() };

  profV = (await createRetentionProfile(p, {
    actor: await ctx(admin), now: NOW, correlationId: cid("pf"),
    profile: {
      code: "PROF-V-1G", responsibleId: admin, basisNote: "Test ortamı dayanak notu", startEvent: "MANUAL_EVENT",
      durationValue: 1, durationUnit: "CALENDAR_DAYS", effectiveFrom: "2020-01-01", disposalMethod: "DIGITAL_DELETE",
      disposalApproverIds: [apprB, apprC],
    },
  })).profileId;
  await verifyRetentionProfileByLegal(p, { actor: await ctx(recA), now: NOW, correlationId: cid("lv"), profileId: profV, expectedRowVersion: 1 });
  profU = (await createRetentionProfile(p, {
    actor: await ctx(admin), now: NOW, correlationId: cid("pf"),
    profile: {
      code: "PROF-U-1G", responsibleId: admin, basisNote: "Doğrulanmamış", startEvent: "MANUAL_EVENT",
      durationValue: 1, durationUnit: "CALENDAR_DAYS", effectiveFrom: "2020-01-01", disposalMethod: "DIGITAL_DELETE",
      disposalApproverIds: [apprB, apprC],
    },
  })).profileId;
});

afterAll(async () => {
  await db.stop();
});

/** Yükle + tara + belge oluştur (READY). */
async function makeDoc(
  tag: string,
  o: { actorId?: string; departmentId?: string | null; typeCode?: string; metadata?: Record<string, string> } = {},
) {
  const actorId = o.actorId ?? admin;
  const up = await registerUpload(deps, {
    actorId, correlationId: cid("up"), filename: `${tag}.pdf`, declaredMime: "application/pdf", bytes: PDF(tag), maxBytes: MAX,
  });
  if (up.status !== "QUARANTINED") throw new Error(`yükleme beklenmedik: ${up.status}`);
  const created = await createDocument(db.prisma, {
    actorId, correlationId: cid("cr"), typeCode: o.typeCode ?? "GENEL", title: `Başlık ${tag}`,
    metadata: o.metadata ?? {}, departmentId: o.departmentId ?? null, fileObjectId: up.fileObjectId, now: NOW,
  });
  await scanFile(deps, { fileObjectId: up.fileObjectId, actorId: null, correlationId: cid("sc") });
  const fo = await db.prisma.documentFileObject.findUniqueOrThrow({ where: { id: up.fileObjectId } });
  return { documentId: created.documentId, fileObjectId: up.fileObjectId, storageKey: fo.storageKey };
}

async function assign(documentId: string, profileId: string) {
  const d = await db.prisma.document.findUniqueOrThrow({ where: { id: documentId }, select: { rowVersion: true } });
  await assignRetentionProfile(db.prisma, {
    actor: await ctx(recA), now: NOW, correlationId: cid("as"), documentId, profileId, expectedRowVersion: d.rowVersion,
  });
}

async function trigger(documentId: string, eventDate = "2020-01-01") {
  await recordRetentionTriggerEvent(db.prisma, {
    actor: await ctx(recA), now: NOW, correlationId: cid("tg"), documentId, eventDate, note: "Test tetikleyici olayı",
  });
}

const scan = () => scanDispositionCandidates(db.prisma, { now: NOW, correlationId: cid("scan") });

async function reviewOf(documentId: string) {
  return db.prisma.dispositionReview.findFirstOrThrow({ where: { documentId }, orderBy: { createdAt: "desc" } });
}

async function decide(actorId: string, reviewId: string, decision: "APPROVE" | "REJECT" | "EXTEND") {
  const r = await db.prisma.dispositionReview.findUniqueOrThrow({ where: { id: reviewId }, select: { rowVersion: true } });
  return decideDispositionReview(db.prisma, {
    actor: await ctx(actorId), now: NOW, correlationId: cid("dc"), reviewId, expectedRowVersion: r.rowVersion,
    decision, reason: "Test kararı",
  });
}

/** Belgeyi tam imha hattına hazırlar: profil + tetikleyici + tarama → PENDING_REVIEW. */
async function readyForReview(tag: string) {
  const d = await makeDoc(tag);
  await assign(d.documentId, profV);
  await trigger(d.documentId);
  await scan();
  const r = await reviewOf(d.documentId);
  if (r.status !== "PENDING_REVIEW") throw new Error(`beklenen PENDING_REVIEW, gelen ${r.status}`);
  return { ...d, reviewId: r.id };
}

async function auditCount(where: Prisma.AuditEventWhereInput) {
  return db.prisma.auditEvent.count({ where });
}

describe("Saklama profili (R-RET-01)", () => {
  it("profil yokken imha yok; politika eksiği bildirilir; doğrulanmamış profil BLOCKED kalır", async () => {
    const doc0 = await makeDoc("p-yok");
    const doc1 = await makeDoc("p-dogrulanmamis");
    await assign(doc1.documentId, profU);
    await trigger(doc1.documentId);
    await scan();

    const st = await getRetentionStatus(db.prisma, { actor: await ctx(recA), now: NOW, documentId: doc0.documentId });
    expect(st.profile).toBeNull();
    expect(st.policyGap).toBe(true);
    expect(st.eligible).toBe(false);
    expect(st.blocks).toContain("NO_RETENTION_PROFILE");
    expect(await db.prisma.dispositionReview.count({ where: { documentId: doc0.documentId } })).toBe(0);
    const d0 = await db.prisma.document.findUniqueOrThrow({ where: { id: doc0.documentId } });
    expect(d0.generalStatus).not.toBe("DISPOSAL_REVIEW");

    const r1 = await reviewOf(doc1.documentId);
    expect(r1.status).toBe("BLOCKED");
    expect(r1.blockedReason).toContain("PROFILE_NOT_VERIFIED");
    await expect(decide(apprB, r1.id, "APPROVE")).rejects.toMatchObject({ code: "DISPOSAL_STATE_INVALID" });
    const res = await runDispositionWorker(db.prisma, { storage, now: NOW, correlationId: cid("w"), reviewId: r1.id });
    expect(res).toEqual([]);
    expect(storage.map.has(doc1.storageKey)).toBe(true);
  });

  it("hukuki doğrulama eksik profille reddedilir (dayanak notu, süre, onaycı sayısı)", async () => {
    const noBasis = await createRetentionProfile(db.prisma, {
      actor: await ctx(admin), now: NOW, correlationId: cid("pf"),
      profile: { code: "PROF-NB", responsibleId: admin, startEvent: "MANUAL_EVENT", durationValue: 1, durationUnit: "CALENDAR_DAYS", effectiveFrom: "2020-01-01", disposalMethod: "DIGITAL_DELETE", disposalApproverIds: [apprB, apprC] },
    });
    await expect(verifyRetentionProfileByLegal(db.prisma, { actor: await ctx(recA), now: NOW, correlationId: cid("lv"), profileId: noBasis.profileId, expectedRowVersion: 1 })).rejects.toMatchObject({ code: "PROFILE_INVALID" });

    const oneApprover = await createRetentionProfile(db.prisma, {
      actor: await ctx(admin), now: NOW, correlationId: cid("pf"),
      profile: { code: "PROF-1A", responsibleId: admin, basisNote: "Dayanak", startEvent: "MANUAL_EVENT", durationValue: 1, durationUnit: "CALENDAR_DAYS", effectiveFrom: "2020-01-01", disposalMethod: "DIGITAL_DELETE", disposalApproverIds: [apprB] },
    });
    await expect(verifyRetentionProfileByLegal(db.prisma, { actor: await ctx(recA), now: NOW, correlationId: cid("lv"), profileId: oneApprover.profileId, expectedRowVersion: 1 })).rejects.toMatchObject({ code: "PROFILE_INVALID" });

    // Süre belirsizse (sınırsız değil, boş) hukuki doğrulama yapılamaz; evrensel varsayılan süre yoktur.
    const noDuration = await createRetentionProfile(db.prisma, {
      actor: await ctx(admin), now: NOW, correlationId: cid("pf"),
      profile: { code: "PROF-ND", responsibleId: admin, basisNote: "Dayanak", startEvent: "MANUAL_EVENT", effectiveFrom: "2020-01-01", disposalMethod: "DIGITAL_DELETE", disposalApproverIds: [apprB, apprC] },
    });
    await expect(verifyRetentionProfileByLegal(db.prisma, { actor: await ctx(recA), now: NOW, correlationId: cid("lv"), profileId: noDuration.profileId, expectedRowVersion: 1 })).rejects.toMatchObject({ code: "PROFILE_INVALID" });
  });

  it("kural değişikliği yeni sürüm üretir; geçmiş sürüm değişmez; doğrulama sıfırlanır", async () => {
    const created = await createRetentionProfile(db.prisma, {
      actor: await ctx(admin), now: NOW, correlationId: cid("pf"),
      profile: { code: "PROF-VER", responsibleId: admin, basisNote: "Dayanak", startEvent: "MANUAL_EVENT", durationValue: 1, durationUnit: "CALENDAR_DAYS", effectiveFrom: "2020-01-01", disposalMethod: "DIGITAL_DELETE", disposalApproverIds: [apprB, apprC] },
    });
    const first = await db.prisma.retentionRuleVersion.findFirstOrThrow({ where: { profileId: created.profileId, version: 1 } });
    await verifyRetentionProfileByLegal(db.prisma, { actor: await ctx(recA), now: NOW, correlationId: cid("lv"), profileId: created.profileId, expectedRowVersion: 1 });
    const verified = await db.prisma.retentionProfile.findUniqueOrThrow({ where: { id: created.profileId } });
    expect(verified.verifiedByLegal).toBe(true);
    const upd = await updateRetentionProfile(db.prisma, {
      actor: await ctx(admin), now: NOW, correlationId: cid("pu"), profileId: created.profileId, expectedRowVersion: verified.rowVersion,
      profile: { code: "PROF-VER", responsibleId: admin, basisNote: "Dayanak v2", startEvent: "MANUAL_EVENT", durationValue: 2, durationUnit: "CALENDAR_DAYS", effectiveFrom: "2020-01-01", disposalMethod: "DIGITAL_DELETE", disposalApproverIds: [apprB, apprC] },
    });
    expect(upd.verifiedByLegal).toBe(false);
    const after = await db.prisma.retentionProfile.findUniqueOrThrow({ where: { id: created.profileId } });
    expect(after.verifiedByLegal).toBe(false);
    const again = await db.prisma.retentionRuleVersion.findFirstOrThrow({ where: { profileId: created.profileId, version: 1 } });
    expect(again.snapshot).toEqual(first.snapshot);
    expect(await db.prisma.retentionRuleVersion.count({ where: { profileId: created.profileId } })).toBeGreaterThanOrEqual(3);
  });

  it("başlangıç olayları: belge tarihi, mali yıl sonu (harita yoksa çözülmez), manuel olay, sözleşme bitişi", async () => {
    const st = async (documentId: string, fy?: Record<string, string>) =>
      getRetentionStatus(db.prisma, { actor: await ctx(recA), now: NOW, documentId, ...(fy ? { fiscalYearEndByYear: fy } : {}) });

    // DOCUMENT_CREATED
    const docCreated = await makeDoc("ev-created");
    const pDoc = await createRetentionProfile(db.prisma, {
      actor: await ctx(admin), now: NOW, correlationId: cid("pf"),
      profile: { code: "PROF-EV-DOC", responsibleId: admin, basisNote: "Dayanak", startEvent: "DOCUMENT_CREATED", durationValue: 30, durationUnit: "CALENDAR_DAYS", effectiveFrom: "2020-01-01", disposalMethod: "DIGITAL_DELETE", disposalApproverIds: [apprB, apprC] },
    });
    await assign(docCreated.documentId, pDoc.profileId);
    const dc = await db.prisma.document.findUniqueOrThrow({ where: { id: docCreated.documentId } });
    const sDoc = await st(docCreated.documentId);
    expect(sDoc.startEvent).toBe("DOCUMENT_CREATED");
    expect(sDoc.startDate).toBe(istanbulDate(dc.createdAt));
    expect(sDoc.dueDate).not.toBeNull();
    if (!sDoc.dueDate || !sDoc.startDate) throw new Error("vade/başlangıç yok");
    expect(sDoc.dueDate > sDoc.startDate).toBe(true);

    // FISCAL_YEAR_END: harita yoksa başlangıç çözülmez (uydurma tarih yok)
    const docFy = await makeDoc("ev-fy");
    const pFy = await createRetentionProfile(db.prisma, {
      actor: await ctx(admin), now: NOW, correlationId: cid("pf"),
      profile: { code: "PROF-EV-FY", responsibleId: admin, basisNote: "Dayanak", startEvent: "FISCAL_YEAR_END", durationValue: 1, durationUnit: "CALENDAR_YEARS", effectiveFrom: "2020-01-01", disposalMethod: "DIGITAL_DELETE", disposalApproverIds: [apprB, apprC] },
    });
    await assign(docFy.documentId, pFy.profileId);
    const sFyNone = await st(docFy.documentId);
    expect(sFyNone.startDate).toBeNull();
    expect(sFyNone.dueDate).toBeNull();
    const year = istanbulDate(dc.createdAt).slice(0, 4);
    const sFy = await st(docFy.documentId, { [year]: `${year}-12-31` });
    expect(sFy.startDate).toBe(`${year}-12-31`);
    expect(sFy.dueDate).toBe(`${String(Number(year) + 1)}-12-31`);

    // MANUAL_EVENT: olay yoksa başlamaz; olay kaydedilince başlar
    const docMan = await makeDoc("ev-manual");
    await assign(docMan.documentId, profV);
    expect((await st(docMan.documentId)).startDate).toBeNull();
    await trigger(docMan.documentId, "2026-03-01");
    const sMan = await st(docMan.documentId);
    expect(sMan.startDate).toBe("2026-03-01");
    expect(sMan.dueDate).toBe("2026-03-02");

    // CONTRACT_END: sözleşme bitiş tarihi
    const ct = await createContract(db.prisma, {
      actorId: admin, correlationId: cid("ct"), typeCode: "SOZLESME", title: "Bitiş testi sözleşmesi", counterpartyId: cpId, now: NOW,
    });
    await db.prisma.contractRecord.updateMany({ where: { documentId: ct.documentId }, data: { endDate: new Date("2026-06-30T00:00:00Z") } });
    const pCe = await createRetentionProfile(db.prisma, {
      actor: await ctx(admin), now: NOW, correlationId: cid("pf"),
      profile: { code: "PROF-EV-CE", responsibleId: admin, basisNote: "Dayanak", startEvent: "CONTRACT_END", durationValue: 1, durationUnit: "CALENDAR_DAYS", effectiveFrom: "2020-01-01", disposalMethod: "DIGITAL_DELETE", disposalApproverIds: [apprB, apprC] },
    });
    await assign(ct.documentId, pCe.profileId);
    const sCe = await st(ct.documentId);
    expect(sCe.startDate).toBe("2026-06-30");
    expect(sCe.dueDate).toBe("2026-07-01");
  });
});

describe("Hukuki bekletme (R-HOLD)", () => {
  it("bekletme imhayı engeller; kapsam kaydedilir; her deneme denetime yazılır", async () => {
    const d = await readyForReview("hold");

    const hold = await placeLegalHold(db.prisma, { actor: await ctx(recA), now: NOW, correlationId: cid("h"), documentId: d.documentId, reason: "Dava dosyası" });
    expect(hold.scope.versionIds.length).toBe(1);
    expect(hold.scope.fileObjectIds).toEqual([d.fileObjectId]);
    expect(await auditCount({ eventType: "LEGAL_HOLD_PLACED", targetId: d.documentId })).toBe(1);

    // Görünmeyen belge: varlık sızdırılmaz (NOT_FOUND), ama deneme yine denetime yazılır.
    await expect(placeLegalHold(db.prisma, { actor: await ctx(plain), now: NOW, correlationId: cid("h"), documentId: d.documentId, reason: "Deneme" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await auditCount({ eventType: "LEGAL_HOLD_PLACE_DENIED", targetId: d.documentId, reason: "NOT_VISIBLE" })).toBe(1);
    // Görünür ama yetkisiz: FORBIDDEN ve denetim.
    await expect(placeLegalHold(db.prisma, { actor: await ctx(apprB), now: NOW, correlationId: cid("h"), documentId: d.documentId, reason: "Deneme" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await auditCount({ eventType: "LEGAL_HOLD_PLACE_DENIED", targetId: d.documentId, reason: "NO_PERMISSION" })).toBe(1);

    const rv = await db.prisma.dispositionReview.findUniqueOrThrow({ where: { id: d.reviewId } });
    await expect(decide(apprB, d.reviewId, "APPROVE")).rejects.toMatchObject({ code: "LEGAL_HOLD_ACTIVE" });
    expect(await auditCount({ eventType: "DISPOSAL_DECISION_DENIED", targetId: d.documentId, reason: "LEGAL_HOLD_ACTIVE" })).toBe(1);
    expect(rv.status).toBe("PENDING_REVIEW");

    await scan();
    const blocked = await reviewOf(d.documentId);
    expect(blocked.status).toBe("BLOCKED");
    expect(blocked.blockedReason).toContain("LEGAL_HOLD_ACTIVE");
    const none = await runDispositionWorker(db.prisma, { storage, now: NOW, correlationId: cid("w"), reviewId: d.reviewId });
    expect(none).toEqual([]);
    expect(storage.map.has(d.storageKey)).toBe(true);

    const rel = await releaseLegalHold(db.prisma, { actor: await ctx(recA), now: NOW, correlationId: cid("rl"), holdId: hold.holdId, reason: "Dava kapandı" });
    expect(rel.remainingActiveHolds).toBe(0);
    expect(await auditCount({ eventType: "LEGAL_HOLD_RELEASED", targetId: d.documentId })).toBe(1);
    await scan();
    expect((await reviewOf(d.documentId)).status).toBe("PENDING_REVIEW");
  });

  it("veritabanı katmanı: bekletme varken veya kapsam dışındayken dosya nesnesi silinemez", async () => {
    const d = await makeDoc("db-hold");
    await placeLegalHold(db.prisma, { actor: await ctx(recA), now: NOW, correlationId: cid("h"), documentId: d.documentId, reason: "DB testi" });
    // Kapsam bildirimi yok → tetikleyici reddeder.
    await expect(db.prisma.documentFileObject.deleteMany({ where: { id: d.fileObjectId } })).rejects.toThrow();
    // Kapsam bildirilmiş olsa bile bekletme engeli sürer.
    await expect(
      db.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('ekos.disposal_document_id', ${d.documentId}, true), set_config('ekos.disposal_file_object_ids', ${d.fileObjectId}, true)`;
        await tx.documentFileObject.deleteMany({ where: { id: d.fileObjectId } });
      }),
    ).rejects.toThrow(/bekletme/i);
    expect(await db.prisma.documentFileObject.count({ where: { id: d.fileObjectId } })).toBe(1);
  });
});

describe("İmha akışı (R-DISP)", () => {
  it("çift onay: tek karar yetmez, aynı kişi iki kez onaylayamaz, profil dışı kişi karar veremez", async () => {
    const d = await readyForReview("dual");

    // Profil dışı kullanıcı (hukuk inceleyicisi) karar veremez.
    await expect(decide(recA, d.reviewId, "APPROVE")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await auditCount({ eventType: "DISPOSAL_DECISION_DENIED", targetId: d.documentId, reason: "NOT_PROFILE_APPROVER" })).toBe(1);

    // İnceleyen (B) onaylar → hâlâ PENDING_REVIEW; tek onayla yürütme yok.
    const first = await decide(apprB, d.reviewId, "APPROVE");
    expect(first).toEqual({ status: "PENDING_REVIEW", role: "REVIEWER" });
    expect((await reviewOf(d.documentId)).status).toBe("PENDING_REVIEW");
    const none = await runDispositionWorker(db.prisma, { storage, now: NOW, correlationId: cid("w"), reviewId: d.reviewId });
    expect(none).toEqual([]);

    // Aynı kişi (B) ikinci kez onaylayamaz.
    await expect(decide(apprB, d.reviewId, "APPROVE")).rejects.toMatchObject({ code: "SEPARATION_OF_DUTIES" });

    // İkinci ve farklı onaycı (C) → APPROVED.
    const second = await decide(apprC, d.reviewId, "APPROVE");
    expect(second).toEqual({ status: "APPROVED", role: "SECOND_APPROVER" });
    expect((await reviewOf(d.documentId)).status).toBe("APPROVED");
    const decisions = await db.prisma.dispositionDecision.findMany({ where: { reviewId: d.reviewId }, orderBy: { decidedAt: "asc" } });
    expect(decisions.map((x) => x.role)).toEqual(["REVIEWER", "SECOND_APPROVER"]);
    const [d0, d1] = decisions;
    if (!d0 || !d1) throw new Error("iki karar bekleniyordu");
    expect(d0.actorId).not.toBe(d1.actorId);
  });

  it("manifest ve temizlik: içeriksiz manifest; dosya, OCR, çıkarım, metadata ve dizin silinir; yeniden çalıştırma idempotent", async () => {
    const d = await makeDoc("manifest", { metadata: { ozel_not: "gizli not içeriği" } });
    await assign(d.documentId, profV);
    await trigger(d.documentId);
    await scan();
    const r = await reviewOf(d.documentId);
    expect(r.status).toBe("PENDING_REVIEW");

    // OCR işi + çıkarım (yürütücünün silmesi gereken ikincil veri)
    const ocrKey = `objects/ocr-${cid("k")}`;
    await storage.put(ocrKey, new TextEncoder().encode("ocr metni"));
    await db.prisma.oCRJob.create({ data: { fileObjectId: d.fileObjectId, status: "DONE", languages: "tur", resultStorageKey: ocrKey, confidence: 0.9 } });
    await db.prisma.extractionResult.create({ data: { documentId: d.documentId, fieldKey: "tutar", value: "100", confidence: 0.5, providerKey: "test" } });
    expect(await db.prisma.metadataValue.count({ where: { documentId: d.documentId } })).toBe(1);

    await decide(apprB, r.id, "APPROVE");
    await decide(apprC, r.id, "APPROVE");

    expect(storage.map.has(d.storageKey)).toBe(true);
    const [res] = await runDispositionWorker(db.prisma, { storage, now: NOW, correlationId: cid("w"), reviewId: r.id });
    expect(res).toMatchObject({ status: "EXECUTED", reviewId: r.id });
    if (!res) throw new Error("yürütme sonucu yok");
    expect(res.counts).toMatchObject({ versions: 1, fileObjects: 1, ocrResults: 1, ocrJobs: 1, extractionRows: 1, metadataValues: 1 });

    // Depo temizliği (dosya + OCR sonucu)
    expect(storage.map.has(d.storageKey)).toBe(false);
    expect(storage.map.has(ocrKey)).toBe(false);
    // Veritabanı temizliği
    expect(await db.prisma.documentVersion.count({ where: { documentId: d.documentId } })).toBe(0);
    expect(await db.prisma.documentFileObject.count({ where: { id: d.fileObjectId } })).toBe(0);
    expect(await db.prisma.oCRJob.count({ where: { fileObjectId: d.fileObjectId } })).toBe(0);
    expect(await db.prisma.extractionResult.count({ where: { documentId: d.documentId } })).toBe(0);
    expect(await db.prisma.metadataValue.count({ where: { documentId: d.documentId } })).toBe(0);
    const doc = await db.prisma.document.findUniqueOrThrow({ where: { id: d.documentId } });
    expect(doc.generalStatus).toBe("DISPOSED");
    expect(doc.currentVersionId).toBeNull();
    expect(doc.searchText).toBe("");
    expect(doc.title.startsWith("[İMHA EDİLDİ]")).toBe(true);

    // İçeriksiz manifest + bütünlük
    const row = await db.prisma.disposalManifest.findUniqueOrThrow({ where: { reviewId: r.id } });
    expect(row.manifestSha256).toBe(res.manifestSha256);
    expect(verifyDisposalManifest(row)).toBe(true);
    expect(verifyDisposalManifest({ manifest: { ...(row.manifest as object), result: "BASKA" }, manifestSha256: row.manifestSha256 })).toBe(false);
    const text = JSON.stringify(row.manifest);
    expect(text).not.toContain("Başlık manifest");
    expect(text).not.toContain("gizli not içeriği");
    expect(text).not.toContain("manifest.pdf");
    const body = row.manifest as { approvals: { role: string }[]; result: string; searchIndex: string };
    expect(body.approvals.map((a) => a.role)).toEqual(["REVIEWER", "SECOND_APPROVER"]);
    expect(body.result).toBe("DELETED");
    expect(body.searchIndex).toBe("CLEARED");

    const rv = await db.prisma.dispositionReview.findUniqueOrThrow({ where: { id: r.id } });
    expect(rv.status).toBe("EXECUTED");
    expect(await auditCount({ eventType: "DISPOSAL_EXECUTED", targetId: d.documentId, outcome: "SUCCESS" })).toBe(1);

    // İdempotent: ikinci çalıştırma hiçbir şey yapmaz.
    expect(await runDispositionWorker(db.prisma, { storage, now: NOW, correlationId: cid("w"), reviewId: r.id })).toEqual([]);
  });

  it("uzatma veya red kararı belgeyi arşive çevirir ve yürütmeye almaz", async () => {
    const d = await readyForReview("reject");
    await decide(apprB, d.reviewId, "REJECT");
    const doc = await db.prisma.document.findUniqueOrThrow({ where: { id: d.documentId } });
    expect(doc.generalStatus).toBe("ARCHIVED");
    expect((await db.prisma.dispositionReview.findUniqueOrThrow({ where: { id: d.reviewId } })).status).toBe("REJECTED");
    expect(await runDispositionWorker(db.prisma, { storage, now: NOW, correlationId: cid("w"), reviewId: d.reviewId })).toEqual([]);
  });
});

describe("Çalışan ayrılışı ve sorumluluk devri (R-OFF)", () => {
  it("açık sorumluluk varken hesap kapanmaz; devir loglanır; ayrılan kişi adına işlem yapılamaz; geçmiş silinmez", async () => {
    const emp = await db.prisma.user.create({ data: { email: "emp@t.test", displayName: "Ayrılan", updatedAt: NOW } });
    const empId = emp.id;
    const empRole = await db.prisma.role.create({ data: { code: "R_EMP", name: "Çalışan", updatedAt: NOW } });
    for (const c of ["document.list", "document.view_metadata", "document.edit_metadata", "contract.manage_obligations"]) {
      const perm = await db.prisma.permission.findFirstOrThrow({ where: { code: c } });
      await db.prisma.rolePermission.create({ data: { roleId: empRole.id, permissionId: perm.id } });
    }
    await db.prisma.membership.create({ data: { userId: empId, roleId: empRole.id, ...EMPTY_SCOPE } as never });
    await db.prisma.authSession.create({ data: { userId: empId, tokenHash: "a".repeat(64), createdAt: NOW, expiresAt: new Date(NOW.getTime() + 86_400_000) } });

    const doc = await makeDoc("emp-doc", { actorId: empId });
    const ct = await createContract(db.prisma, { actorId: admin, correlationId: cid("ct"), typeCode: "SOZLESME", title: "Ayrılış sözleşmesi", counterpartyId: cpId, now: NOW });
    await db.prisma.contractRecord.update({ where: { id: ct.contractId }, data: { businessOwnerId: empId, legalReviewerId: empId } });
    await db.prisma.obligation.create({ data: { contractId: ct.contractId, description: "Test yükümlülüğü", responsibleUserId: empId, status: "OPEN" } });

    // Açılış öncesi çalışan belgeye erişebilir.
    await expect(guardDocument(db.prisma, { actor: await ctx(empId), now: NOW, documentId: doc.documentId, permission: "document.view_metadata" })).resolves.toBeDefined();

    const opened = await openOffboardingCase(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("off"), userId: empId, reason: "İşten ayrılış", blockOnUnresolved: true });
    expect(opened.itemCount).toBe(4);

    const u = await db.prisma.user.findUniqueOrThrow({ where: { id: empId } });
    expect(u.status).toBe("OFFBOARDING");
    const sessions = await db.prisma.authSession.findMany({ where: { userId: empId } });
    expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);
    await expect(guardDocument(db.prisma, { actor: await ctx(empId), now: NOW, documentId: doc.documentId, permission: "document.view_metadata" })).rejects.toThrow();

    const c = await getOffboardingCase(db.prisma, { actor: await ctx(admin), now: NOW, caseId: opened.caseId });
    expect(c.items.every((i) => i.status === "OPEN")).toBe(true);
    const docItem = must(c.items.find((i) => i.kind === "DOCUMENT_OWNER"), "doküman kalemi");
    const bizItem = must(c.items.find((i) => i.kind === "CONTRACT_ROLE" && i.field === "businessOwnerId"), "iş sahibi kalemi");
    const legalItem = must(c.items.find((i) => i.kind === "CONTRACT_ROLE" && i.field === "legalReviewerId"), "hukuk kalemi");
    const obItem = must(c.items.find((i) => i.kind === "OBLIGATION_RESPONSIBLE"), "yükümlülük kalemi");

    // Engelleyici modda bırakma yok; tamamlama engellenir.
    await expect(waiveOffboardingItem(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("wv"), caseId: c.id, itemId: docItem.id, note: "Bırak", expectedRowVersion: docItem.rowVersion })).rejects.toMatchObject({ code: "OFFBOARDING_UNRESOLVED" });
    await expect(completeOffboarding(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("oc"), caseId: c.id, expectedRowVersion: c.rowVersion })).rejects.toMatchObject({ code: "OFFBOARDING_UNRESOLVED" });
    expect(await auditCount({ eventType: "OFFBOARDING_COMPLETE_DENIED", targetId: empId })).toBe(1);

    // Yetkisiz alıcıya devir reddedilir ve denetlenir.
    await expect(transferOffboardingItem(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("tr"), caseId: c.id, itemId: docItem.id, toUserId: plain, expectedRowVersion: docItem.rowVersion })).rejects.toMatchObject({ code: "OFFBOARDING_STATE_INVALID" });
    expect(await auditCount({ eventType: "OFFBOARDING_TRANSFER_DENIED", targetId: empId })).toBe(1);
    // Ayrılan kişinin kendisine devir yok.
    await expect(transferOffboardingItem(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("tr"), caseId: c.id, itemId: docItem.id, toUserId: empId, expectedRowVersion: docItem.rowVersion })).rejects.toMatchObject({ code: "OFFBOARDING_STATE_INVALID" });

    // Yetkili alıcıya (recA) devir.
    for (const it of [docItem, bizItem, legalItem, obItem]) {
      await transferOffboardingItem(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("tr"), caseId: c.id, itemId: it.id, toUserId: recA, expectedRowVersion: it.rowVersion });
    }
    expect((await db.prisma.document.findUniqueOrThrow({ where: { id: doc.documentId } })).ownerId).toBe(recA);
    const cr = await db.prisma.contractRecord.findUniqueOrThrow({ where: { id: ct.contractId } });
    expect(cr.businessOwnerId).toBe(recA);
    expect(cr.legalReviewerId).toBe(recA);
    expect((await db.prisma.obligation.findFirstOrThrow({ where: { contractId: ct.contractId } })).responsibleUserId).toBe(recA);
    expect(await auditCount({ eventType: "OFFBOARDING_ITEM_TRANSFERRED", targetId: empId })).toBe(4);

    const cur = await getOffboardingCase(db.prisma, { actor: await ctx(admin), now: NOW, caseId: c.id });
    const done = await completeOffboarding(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("oc"), caseId: c.id, expectedRowVersion: cur.rowVersion });
    expect(done).toEqual({ warning: false, openCount: 0 });
    expect((await db.prisma.user.findUniqueOrThrow({ where: { id: empId } })).status).toBe("DISABLED");
    expect((await db.prisma.offboardingCase.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("COMPLETED");
    expect(await auditCount({ eventType: "OFFBOARDING_COMPLETED", targetId: empId })).toBe(1);

    // Geçmiş silinmez: ayrılan kişinin eski etkinlikleri ve belgesi durur.
    expect(await db.prisma.auditEvent.count({ where: { actorId: empId } })).toBeGreaterThan(0);
    expect(await db.prisma.document.count({ where: { id: doc.documentId } })).toBe(1);
    // Hesap devre dışı: artık hiçbir işlem yapamaz.
    await expect(guardDocument(db.prisma, { actor: await ctx(empId), now: NOW, documentId: doc.documentId, permission: "document.view_metadata" })).rejects.toThrow();
  });

  it("engellemeyen modda bırakma gerekçeli kaydedilir; tamamlama uyarı verir; engelleyici modda bırakma yoktur", async () => {
    const f = await db.prisma.user.create({ data: { email: "empf@t.test", displayName: "F", updatedAt: NOW } });
    const f1 = await makeDoc("f1", { actorId: f.id });
    await makeDoc("f2", { actorId: f.id });
    const opened = await openOffboardingCase(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("off"), userId: f.id, reason: "Ayrılış", blockOnUnresolved: false });
    expect(opened.itemCount).toBe(2);
    const c = await getOffboardingCase(db.prisma, { actor: await ctx(admin), now: NOW, caseId: opened.caseId });
    const i1 = must(c.items.find((i) => i.targetId === f1.documentId), "f1 kalemi");
    await expect(waiveOffboardingItem(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("wv"), caseId: c.id, itemId: i1.id, note: "  ", expectedRowVersion: i1.rowVersion })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await waiveOffboardingItem(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("wv"), caseId: c.id, itemId: i1.id, note: "Belge arşivlendi, sahiplik sonra", expectedRowVersion: i1.rowVersion });
    const waived = await db.prisma.offboardingItem.findUniqueOrThrow({ where: { id: i1.id } });
    expect(waived.status).toBe("WAIVED");
    expect(waived.note).toContain("arşivlendi");

    const res = await completeOffboarding(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("oc"), caseId: c.id, expectedRowVersion: c.rowVersion });
    expect(res).toEqual({ warning: true, openCount: 1 });
    const completed = await db.prisma.auditEvent.findFirstOrThrow({ where: { eventType: "OFFBOARDING_COMPLETED", targetId: f.id } });
    expect((completed.afterSummary as { warning: boolean }).warning).toBe(true);
    expect((await db.prisma.user.findUniqueOrThrow({ where: { id: f.id } })).status).toBe("DISABLED");

    // Engelleyici modda bırakma yok.
    const g = await db.prisma.user.create({ data: { email: "empg@t.test", displayName: "G", updatedAt: NOW } });
    await makeDoc("g1", { actorId: g.id });
    const og = await openOffboardingCase(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("off"), userId: g.id, reason: "Ayrılış", blockOnUnresolved: true });
    const cg = await getOffboardingCase(db.prisma, { actor: await ctx(admin), now: NOW, caseId: og.caseId });
    const gi = cg.items[0];
    if (!gi) throw new Error("kalem yok");
    await expect(waiveOffboardingItem(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("wv"), caseId: cg.id, itemId: gi.id, note: "Bırak", expectedRowVersion: gi.rowVersion })).rejects.toMatchObject({ code: "OFFBOARDING_UNRESOLVED" });
  });
});

describe("Kırılma-cam (R-BG)", () => {
  it("süre 15–240 dk; talep eden onaylayamaz; yetkisiz onay yok; süre sonunda erişim kapanır; kullanım denetlenir", async () => {
    const doc = await makeDoc("bg");
    const plainCtx = () => ctx(plain);

    await expect(requestBreakGlass(db.prisma, { actor: await plainCtx(), now: NOW, correlationId: cid("bg"), permission: "document.view_metadata", documentId: doc.documentId, reason: "Acil", durationMinutes: 10 })).rejects.toMatchObject({ code: "BREAK_GLASS_INVALID" });
    await expect(requestBreakGlass(db.prisma, { actor: await plainCtx(), now: NOW, correlationId: cid("bg"), permission: "document.view_metadata", documentId: doc.documentId, reason: "Acil", durationMinutes: 300 })).rejects.toMatchObject({ code: "BREAK_GLASS_INVALID" });
    await expect(requestBreakGlass(db.prisma, { actor: await plainCtx(), now: NOW, correlationId: cid("bg"), permission: "document.view_metadata", documentId: doc.documentId, reason: " ", durationMinutes: 30 })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    // Normal yetkisi olan kişi kırılma-cam isteyemez.
    await expect(requestBreakGlass(db.prisma, { actor: await ctx(recA), now: NOW, correlationId: cid("bg"), permission: "document.view_metadata", documentId: doc.documentId, reason: "Acil", durationMinutes: 30 })).rejects.toMatchObject({ code: "BREAK_GLASS_INVALID" });

    const req = await requestBreakGlass(db.prisma, { actor: await plainCtx(), now: NOW, correlationId: cid("bg"), permission: "document.view_metadata", documentId: doc.documentId, reason: "Acil denetim", durationMinutes: 30 });
    expect(req.expiresAtIfApproved.getTime()).toBe(NOW.getTime() + 30 * MIN);
    // Onaylanmadan önce erişim yoktur.
    await expect(guardDocument(db.prisma, { actor: await plainCtx(), now: NOW, documentId: doc.documentId, permission: "document.view_metadata" })).rejects.toThrow();

    // Talep eden kendi talebini onaylayamaz; breakglass.approve olmayan onaylayamaz.
    await expect(approveBreakGlass(db.prisma, { actor: await plainCtx(), now: NOW, correlationId: cid("ba"), grantId: req.grantId })).rejects.toMatchObject({ code: "SEPARATION_OF_DUTIES" });
    await expect(approveBreakGlass(db.prisma, { actor: await ctx(recA), now: NOW, correlationId: cid("ba"), grantId: req.grantId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await auditCount({ eventType: "BREAK_GLASS_APPROVE_DENIED", targetId: doc.documentId })).toBe(2);

    // Farklı ve yetkili onaycı (admin) onaylar; süre onayda başlar.
    const t1 = new Date(NOW.getTime() + MIN);
    const appr = await approveBreakGlass(db.prisma, { actor: await ctx(admin, t1), now: t1, correlationId: cid("ba"), grantId: req.grantId });
    expect(appr.expiresAt.getTime()).toBe(t1.getTime() + 30 * MIN);

    // Süre içinde erişim var ve kullanım görünür denetime yazılır.
    const inside = new Date(t1.getTime() + MIN);
    await expect(guardDocument(db.prisma, { actor: await ctx(plain, inside), now: inside, documentId: doc.documentId, permission: "document.view_metadata" })).resolves.toBeDefined();
    await recordBreakGlassUse(db.prisma, { actor: await ctx(plain, inside), now: inside, correlationId: cid("use"), grantId: req.grantId, eventType: "DOCUMENT_PREVIEWED", targetType: "DOCUMENT", targetId: doc.documentId });
    const use = await db.prisma.auditEvent.findFirstOrThrow({ where: { eventType: "DOCUMENT_PREVIEWED", targetId: doc.documentId } });
    expect(use.actorType).toBe("BREAK_GLASS");
    expect(use.actorId).toBe(plain);

    // Süre sonu: tam bitişte ve sonrasında erişim kapanır.
    const end = new Date(t1.getTime() + 30 * MIN);
    await expect(guardDocument(db.prisma, { actor: await ctx(plain, end), now: end, documentId: doc.documentId, permission: "document.view_metadata" })).rejects.toThrow();
    await expect(recordBreakGlassUse(db.prisma, { actor: await ctx(plain, end), now: end, correlationId: cid("use"), grantId: req.grantId, eventType: "DOCUMENT_PREVIEWED", targetType: "DOCUMENT", targetId: doc.documentId })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const after = new Date(end.getTime() + MIN);
    const n = await expireBreakGlassGrants(db.prisma, { now: after, correlationId: cid("exp") });
    expect(n).toBeGreaterThanOrEqual(1);
    expect((await db.prisma.breakGlassGrant.findUniqueOrThrow({ where: { id: req.grantId } })).status).toBe("EXPIRED");
    expect(await auditCount({ eventType: "BREAK_GLASS_EXPIRED", targetId: doc.documentId })).toBe(1);
    expect(await expireBreakGlassGrants(db.prisma, { now: after, correlationId: cid("exp") })).toBe(0);
  });

  it("süre sınırları: 15 ve 240 dakika kabul edilir", async () => {
    const doc = await makeDoc("bg-sinir");
    for (const m of [15, 240]) {
      const r = await requestBreakGlass(db.prisma, { actor: await ctx(plain), now: NOW, correlationId: cid("bg"), permission: "document.view_metadata", documentId: doc.documentId, reason: "Sınır", durationMinutes: m });
      expect(r.expiresAtIfApproved.getTime()).toBe(NOW.getTime() + m * MIN);
    }
  });
});

describe("Denetçi kanıt paketi (R-EVD)", () => {
  it("yetki sınırı: yetkisiz reddedilir; kapsamlı denetçi yalnız görebildiği belgeleri ve sistem olaylarını almaz; checksum doğrulanır", async () => {
    const dA = await makeDoc("ev-a", { departmentId: deptD1 });
    const dB = await makeDoc("ev-b", { departmentId: deptD2 });
    const real = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const from = iso(new Date(real.getTime() - 10 * 86_400_000));
    const to = iso(new Date(real.getTime() + 86_400_000));

    // Yetkisiz kullanıcı: reddedilir ve denetime yazılır.
    await expect(buildEvidencePack(db.prisma, { actor: await ctx(plain), now: NOW, correlationId: cid("ev"), from, to })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await auditCount({ eventType: "EVIDENCE_PACK_DENIED" })).toBeGreaterThanOrEqual(1);

    // Kapsamlı denetçi (D1): sistem olayı yok; yalnız D1 belgeleri; D2 belgesinin olayı yok.
    const scoped = await buildEvidencePack(db.prisma, { actor: await ctx(auditor), now: NOW, correlationId: cid("ev"), from, to });
    expect(scoped.pack.scope).toMatchObject({ systemEventsIncluded: false });
    const docIds = (scoped.pack.documents as { id: string }[]).map((d) => d.id);
    expect(docIds).toContain(dA.documentId);
    expect(docIds).not.toContain(dB.documentId);
    const events = scoped.pack.events as { targetType: string; targetId: string | null }[];
    expect(events.every((e) => e.targetType === "DOCUMENT")).toBe(true);
    expect(events.some((e) => e.targetId === dB.documentId)).toBe(false);
    expect(events.some((e) => e.targetId === dA.documentId)).toBe(true);

    // Kapsamlı denetçi D2 belgesine filtre uygulayamaz (kapsamı dışında).
    const outside = await buildEvidencePack(db.prisma, { actor: await ctx(auditor), now: NOW, correlationId: cid("ev"), from, to, documentId: dB.documentId });
    expect((outside.pack.documents as unknown[]).length).toBe(0);
    expect((outside.pack.events as unknown[]).length).toBe(0);

    // Kapsamsız denetçi (admin): sistem olayları da dahildir.
    const global = await buildEvidencePack(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("ev"), from, to });
    expect(global.pack.scope).toMatchObject({ systemEventsIncluded: true });
    const gEvents = global.pack.events as { eventType: string; targetType: string }[];
    expect(gEvents.some((e) => e.targetType === "RETENTION_PROFILE")).toBe(true);

    // Aralık sınırları.
    await expect(buildEvidencePack(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("ev"), from: "2026-10-10", to: "2026-10-01" })).rejects.toMatchObject({ code: "RANGE_INVALID" });
    await expect(buildEvidencePack(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("ev"), from: "2024-01-01", to: "2026-01-01" })).rejects.toMatchObject({ code: "RANGE_INVALID" });

    // Checksum: doğru paket geçer; değiştirilmiş paket reddedilir.
    expect(verifyEvidencePack(scoped.pack)).toBe(true);
    expect(scoped.pack.sha256).toBe(scoped.sha256);
    expect(verifyEvidencePack({ ...scoped.pack, counts: { ...(scoped.pack.counts as object), events: 999 } })).toBe(false);

    // Dışa aktarma denetime yazılır.
    expect(await auditCount({ eventType: "EVIDENCE_PACK_EXPORTED", targetType: "AUDIT_EXPORT" })).toBeGreaterThanOrEqual(2);
  });
});
