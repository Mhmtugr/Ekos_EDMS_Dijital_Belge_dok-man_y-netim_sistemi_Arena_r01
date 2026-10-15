// Faz 4 açık kalemleri testleri (GERÇEK PostgreSQL): mali yıl takvimi, ayrılış iptali, kullanıcı seçici,
// kırılma-cam sayfalama, tutanak PDF yapısı ve yürütülmüş imhadan tutanak üretimi.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadActorContext } from "../actor.js";
import { createDocument } from "../documents/create.js";
import { registerUpload, scanFile } from "../documents/upload.js";
import { startTestDb, type TestDb } from "../testing/pg-harness.js";
import { FakeAv, MemStorage } from "../testing/fakes.js";
import { createRetentionProfile, assignRetentionProfile, getRetentionStatus, recordRetentionTriggerEvent, verifyRetentionProfileByLegal } from "./retention.js";
import { decideDispositionReview, runDispositionWorker, scanDispositionCandidates } from "./disposal.js";
import { buildDisposalCertificate, buildPdf, certificateLines, listExecutedDispositions } from "./certificate.js";
import { listFiscalYearEnds, loadFiscalYearMap, setFiscalYearEnd } from "./fiscal.js";
import { cancelOffboardingCase, completeOffboarding, getOffboardingCase, listOffboardingCases, openOffboardingCase, searchActiveUsers, waiveOffboardingItem } from "./offboarding.js";
import { randomUUID } from "node:crypto";
import { BREAK_GLASS_PAGE_SIZE, listBreakGlassGrants, requestBreakGlass } from "./breakglass.js";
import type { Prisma } from "@prisma/client";

const NOW = new Date("2026-10-14T06:00:00Z");
const MAX = 10 * 1024 * 1024;
const PDF = (tag: string) => new TextEncoder().encode(`%PDF-1.7\n% ${tag}\n${"x".repeat(64)}\n%%EOF`);
const EMPTY_SCOPE = { departmentIds: [], documentTypeIds: [], counterpartyIds: [], projectIds: [], updatedAt: NOW };

let db: TestDb;
let storage: MemStorage;
let deps: { prisma: TestDb["prisma"]; storage: MemStorage; av: FakeAv };
let admin: string;
let plain: string;
let recA: string;
let apprB: string;
let apprC: string;
let profV: string;
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
  const codes = ["document.list", "document.view_metadata", "document.retention_review", "document.disposal_approve", "document.legal_hold", "contract.legal_review", "config.manage", "user.manage", "breakglass.approve", "audit.export"];
  await p.permission.createMany({ data: codes.map((code) => ({ code, description: code })) });
  const perms = await p.permission.findMany();
  const pid = (c: string) => must(perms.find((x) => x.code === c), c).id;
  const role = async (code: string, list: string[]) => {
    const r = await p.role.create({ data: { code, name: code, updatedAt: NOW } });
    for (const c of list) await p.rolePermission.create({ data: { roleId: r.id, permissionId: pid(c) } });
    return r.id;
  };
  const rOps = await role("R_OPS", ["config.manage", "user.manage", "breakglass.approve", "audit.export", "document.list", "document.view_metadata"]);
  const rRev = await role("R_REV", ["document.list", "document.view_metadata", "document.retention_review", "document.legal_hold", "contract.legal_review"]);
  const rApp = await role("R_APP", ["document.list", "document.view_metadata", "document.retention_review", "document.disposal_approve"]);
  const user = async (tag: string, status: "ACTIVE" | "DISABLED" = "ACTIVE") =>
    (await p.user.create({ data: { email: `${tag}@c.test`, displayName: tag, status, updatedAt: NOW } })).id;
  admin = await user("admin");
  plain = await user("plain");
  recA = await user("reviewer");
  apprB = await user("apprb");
  apprC = await user("apprc");
  await user("pasif-kisi", "DISABLED");
  await p.membership.create({ data: { userId: admin, roleId: rOps, ...EMPTY_SCOPE } as never });
  await p.membership.create({ data: { userId: recA, roleId: rRev, ...EMPTY_SCOPE } as never });
  await p.membership.create({ data: { userId: apprB, roleId: rApp, ...EMPTY_SCOPE } as never });
  await p.membership.create({ data: { userId: apprC, roleId: rApp, ...EMPTY_SCOPE } as never });
  await p.documentType.create({ data: { code: "GENEL", name: "Genel", defaultConfidentiality: "INTERNAL", requiredMetadataKeys: [], updatedAt: NOW } as never });
  await p.legalEntity.create({ data: { name: "EKOS Test A.Ş.", countryCode: "TR", updatedAt: NOW } as never });
  storage = new MemStorage();
  deps = { prisma: p, storage, av: new FakeAv() };
  profV = (
    await createRetentionProfile(p, {
      actor: await ctx(admin), now: NOW, correlationId: cid("pf"),
      profile: {
        code: "PROF-V-C", responsibleId: admin, basisNote: "Test ortamı dayanak notu", startEvent: "MANUAL_EVENT",
        durationValue: 1, durationUnit: "CALENDAR_DAYS", effectiveFrom: "2020-01-01", disposalMethod: "DIGITAL_DELETE",
        disposalApproverIds: [apprB, apprC],
      },
    })
  ).profileId;
  await verifyRetentionProfileByLegal(p, { actor: await ctx(recA), now: NOW, correlationId: cid("lv"), profileId: profV, expectedRowVersion: 1 });
});

afterAll(async () => {
  await db.stop();
});

async function makeDoc(tag: string) {
  const up = await registerUpload(deps, {
    actorId: admin, correlationId: cid("up"), filename: `${tag}.pdf`, declaredMime: "application/pdf", bytes: PDF(tag), maxBytes: MAX,
  });
  if (up.status !== "QUARANTINED") throw new Error(`yükleme beklenmedik: ${up.status}`);
  const created = await createDocument(db.prisma, {
    actorId: admin, correlationId: cid("cr"), typeCode: "GENEL", title: `Başlık ${tag}`, metadata: {}, departmentId: null,
    fileObjectId: up.fileObjectId, now: NOW,
  });
  await scanFile(deps, { fileObjectId: up.fileObjectId, actorId: null, correlationId: cid("sc") });
  return { documentId: created.documentId };
}

describe("mali yıl sonu takvimi (FISCAL_YEAR_END)", () => {
  it("yetkisiz kullanıcı yazamaz ve listeleyemez; geçersiz tarih reddedilir", async () => {
    await expect(setFiscalYearEnd(db.prisma, { actor: await ctx(plain), now: NOW, correlationId: cid("fy"), year: 2025, endDate: "2025-12-31", expectedRowVersion: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listFiscalYearEnds(db.prisma, { actor: await ctx(plain), now: NOW })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setFiscalYearEnd(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("fy"), year: 2025, endDate: "2026-12-31", expectedRowVersion: null })).rejects.toMatchObject({ code: "FISCAL_YEAR_INVALID" });
    await expect(setFiscalYearEnd(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("fy"), year: 2025, endDate: "2025-02-30", expectedRowVersion: null })).rejects.toMatchObject({ code: "FISCAL_YEAR_INVALID" });
  });

  it("oluşturma, sürüm kontrollü güncelleme ve audit", async () => {
    const created = await setFiscalYearEnd(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("fy"), year: 2025, endDate: "2025-12-31", expectedRowVersion: null });
    expect(created.rowVersion).toBe(1);
    await expect(setFiscalYearEnd(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("fy"), year: 2025, endDate: "2025-06-30", expectedRowVersion: null })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(setFiscalYearEnd(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("fy"), year: 2025, endDate: "2025-06-30", expectedRowVersion: 7 })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const upd = await setFiscalYearEnd(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("fy"), year: 2025, endDate: "2025-06-30", expectedRowVersion: 1 });
    expect(upd.rowVersion).toBe(2);
    const map = await loadFiscalYearMap(db.prisma);
    expect(map["2025"]).toBe("2025-06-30");
    const list = await listFiscalYearEnds(db.prisma, { actor: await ctx(admin), now: NOW });
    expect(list.find((x) => x.year === 2025)?.endDate).toBe("2025-06-30");
    expect(await db.prisma.auditEvent.count({ where: { eventType: "FISCAL_YEAR_END_SET" } })).toBeGreaterThanOrEqual(2);
  });

  it("saklama çözümlemesi varsayılan olarak DB'deki takvimi okur", async () => {
    const d = await makeDoc("fy-doc");
    const pf = await createRetentionProfile(db.prisma, {
      actor: await ctx(admin), now: NOW, correlationId: cid("pf"),
      profile: {
        code: "PROF-FY-C", responsibleId: admin, basisNote: "Dayanak", startEvent: "FISCAL_YEAR_END", durationValue: 5, durationUnit: "CALENDAR_YEARS",
        effectiveFrom: "2020-01-01", disposalMethod: "DIGITAL_DELETE", disposalApproverIds: [apprB, apprC],
      },
    });
    const doc = await db.prisma.document.findUniqueOrThrow({ where: { id: d.documentId }, select: { rowVersion: true, createdAt: true } });
    await assignRetentionProfile(db.prisma, { actor: await ctx(recA), now: NOW, correlationId: cid("as"), documentId: d.documentId, profileId: pf.profileId, expectedRowVersion: doc.rowVersion });
    const year = String(doc.createdAt.getUTCFullYear());
    await setFiscalYearEnd(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("fy"), year: Number(year), endDate: `${year}-12-31`, expectedRowVersion: null });
    const st = await getRetentionStatus(db.prisma, { actor: await ctx(recA), now: NOW, documentId: d.documentId });
    expect(st.startDate).toBe(`${year}-12-31`);
  });
});

describe("ayrılış dosyası: liste, iptal, kullanıcı seçici", () => {
  it("iptal: gerekçe, sürüm, durum ve kullanıcı geri açılışı", async () => {
    const emp = await db.prisma.user.create({ data: { email: "emp-iptal@c.test", displayName: "Ayrılan Çalışan", updatedAt: NOW } });
    const opened = await openOffboardingCase(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("off"), userId: emp.id, reason: "Ayrılış", blockOnUnresolved: false });
    const c0 = await getOffboardingCase(db.prisma, { actor: await ctx(admin), now: NOW, caseId: opened.caseId });
    expect(c0.status).toBe("OPEN");
    await expect(cancelOffboardingCase(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("ic"), caseId: opened.caseId, reason: "   ", expectedRowVersion: c0.rowVersion })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await expect(cancelOffboardingCase(db.prisma, { actor: await ctx(plain), now: NOW, correlationId: cid("ic"), caseId: opened.caseId, reason: "Kurumda kalıyor", expectedRowVersion: c0.rowVersion })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(cancelOffboardingCase(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("ic"), caseId: opened.caseId, reason: "Kurumda kalıyor", expectedRowVersion: 99 })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });

    await cancelOffboardingCase(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("ic"), caseId: opened.caseId, reason: "Kurumda kalıyor", expectedRowVersion: c0.rowVersion });
    const c1 = await getOffboardingCase(db.prisma, { actor: await ctx(admin), now: NOW, caseId: opened.caseId });
    expect(c1.status).toBe("CANCELLED");
    expect(c1.cancelReason).toBe("Kurumda kalıyor");
    const u = await db.prisma.user.findUniqueOrThrow({ where: { id: emp.id } });
    expect(u.status).toBe("ACTIVE");
    expect(await db.prisma.auditEvent.count({ where: { eventType: "OFFBOARDING_CANCELLED", targetId: emp.id } })).toBe(1);
    // İptal edilmiş dosya tekrar iptal edilemez ve tamamlanamaz.
    await expect(cancelOffboardingCase(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("ic"), caseId: opened.caseId, reason: "Tekrar", expectedRowVersion: c1.rowVersion })).rejects.toMatchObject({ code: "OFFBOARDING_STATE_INVALID" });
    await expect(completeOffboarding(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("oc"), caseId: opened.caseId, expectedRowVersion: c1.rowVersion })).rejects.toMatchObject({ code: "OFFBOARDING_STATE_INVALID" });
    // Liste filtresi
    const cancelled = await listOffboardingCases(db.prisma, { actor: await ctx(admin), now: NOW, status: "CANCELLED" });
    expect(cancelled.some((x) => x.id === opened.caseId)).toBe(true);
    const open = await listOffboardingCases(db.prisma, { actor: await ctx(admin), now: NOW, status: "OPEN" });
    expect(open.some((x) => x.id === opened.caseId)).toBe(false);
    await expect(listOffboardingCases(db.prisma, { actor: await ctx(plain), now: NOW, status: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("tamamlanmış dosya iptal edilemez", async () => {
    const emp = await db.prisma.user.create({ data: { email: "emp-bitti@c.test", displayName: "Biten Dosya", updatedAt: NOW } });
    const opened = await openOffboardingCase(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("off"), userId: emp.id, reason: "Ayrılış", blockOnUnresolved: false });
    const c = await getOffboardingCase(db.prisma, { actor: await ctx(admin), now: NOW, caseId: opened.caseId });
    await completeOffboarding(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("oc"), caseId: opened.caseId, expectedRowVersion: c.rowVersion });
    const done = await getOffboardingCase(db.prisma, { actor: await ctx(admin), now: NOW, caseId: opened.caseId });
    await expect(cancelOffboardingCase(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("ic"), caseId: opened.caseId, reason: "Geç", expectedRowVersion: done.rowVersion })).rejects.toMatchObject({ code: "OFFBOARDING_STATE_INVALID" });
  });

  it("kullanıcı seçici yalnızca aktif hesapları döndürür ve yetki ister", async () => {
    const found = await searchActiveUsers(db.prisma, { actor: await ctx(admin), now: NOW, q: "pasif-kisi" });
    expect(found).toEqual([]);
    const byName = await searchActiveUsers(db.prisma, { actor: await ctx(admin), now: NOW, q: "APPRB" });
    expect(byName.map((x) => x.displayName)).toEqual(["apprb"]);
    expect(Object.keys(byName[0] ?? {}).sort()).toEqual(["displayName", "email", "id"]);
    await expect(searchActiveUsers(db.prisma, { actor: await ctx(plain), now: NOW, q: "a" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("bekleyen onay görevi (ayrılış engeli)", () => {
  it("engelleyici modda açık onay görevi: tamamlama ve feragat reddedilir; tek çıkış devir veya iptal", async () => {
    const p = db.prisma;
    const holder = await p.user.create({ data: { email: "gorevli@c.test", displayName: "Görevli Onaycı", updatedAt: NOW } });
    const def = await p.workflowDefinition.create({ data: { code: "TEST-ONAY-OFF", name: "Test onay akışı", updatedAt: NOW } });
    const ver = await p.workflowDefinitionVersion.create({ data: { definitionId: def.id, version: 1, definition: {} } });
    const inst = await p.workflowInstance.create({ data: { definitionVersionId: ver.id, subjectType: "CONTRACT", subjectId: randomUUID(), startedById: admin } });
    const step = await p.workflowStep.create({ data: { instanceId: inst.id, orderIndex: 1, status: "ACTIVE" } });
    await p.approvalTask.create({ data: { stepId: step.id, assigneeId: holder.id } });

    const opened = await openOffboardingCase(p, { actor: await ctx(admin), now: NOW, correlationId: cid("off"), userId: holder.id, reason: "Ayrılış", blockOnUnresolved: true });
    expect(opened.itemCount).toBe(1);
    const c0 = await getOffboardingCase(p, { actor: await ctx(admin), now: NOW, caseId: opened.caseId });
    const item = must(c0.items.find((x) => x.kind === "APPROVAL_TASK"), "onay görevi kalemi");
    expect(item.targetId).toBeTruthy();

    // Engelleyici modda açık kalem bırakılamaz (feragat yok) ve dosya tamamlanamaz.
    await expect(waiveOffboardingItem(p, { actor: await ctx(admin), now: NOW, correlationId: cid("wv"), caseId: opened.caseId, itemId: item.id, note: "Gerekçe", expectedRowVersion: c0.rowVersion })).rejects.toMatchObject({ code: "OFFBOARDING_UNRESOLVED" });
    await expect(completeOffboarding(p, { actor: await ctx(admin), now: NOW, correlationId: cid("oc"), caseId: opened.caseId, expectedRowVersion: c0.rowVersion })).rejects.toMatchObject({ code: "OFFBOARDING_UNRESOLVED" });
    expect((await p.user.findUniqueOrThrow({ where: { id: holder.id } })).status).toBe("OFFBOARDING");

    // Çıkış: dosya iptali; hesap tekrar ACTIVE, onay görevi çalışanda kalır.
    await cancelOffboardingCase(p, { actor: await ctx(admin), now: NOW, correlationId: cid("ic"), caseId: opened.caseId, reason: "Görev devredilmedi, çalışan kurumda kalıyor", expectedRowVersion: c0.rowVersion });
    expect((await p.user.findUniqueOrThrow({ where: { id: holder.id } })).status).toBe("ACTIVE");
    const task = await p.approvalTask.findFirstOrThrow({ where: { assigneeId: holder.id } });
    expect(task.status).toBe("PENDING");
  });
});

describe("kırılma-cam sayfalama", () => {
  it("sayfa boyutu aşıldığında hasMore ve ikinci sayfa doğru çalışır", async () => {
    const d = await makeDoc("bg-page");
    for (let i = 0; i < BREAK_GLASS_PAGE_SIZE + 1; i++) {
      await requestBreakGlass(db.prisma, { actor: await ctx(plain), now: NOW, correlationId: cid("bg"), permission: "document.view_metadata", documentId: d.documentId, reason: `Acil ${String(i)}`, durationMinutes: 30 });
    }
    const p1 = await listBreakGlassGrants(db.prisma, { actor: await ctx(plain), now: NOW, page: 1 });
    expect(p1.items).toHaveLength(BREAK_GLASS_PAGE_SIZE);
    expect(p1.hasMore).toBe(true);
    expect(p1.page).toBe(1);
    const p2 = await listBreakGlassGrants(db.prisma, { actor: await ctx(plain), now: NOW, page: 2 });
    expect(p2.items).toHaveLength(1);
    expect(p2.hasMore).toBe(false);
    const ids1 = new Set(p1.items.map((x) => x.id));
    expect(p2.items.some((x) => ids1.has(x.id))).toBe(false);
    const bad = await listBreakGlassGrants(db.prisma, { actor: await ctx(plain), now: NOW, page: 0 });
    expect(bad.page).toBe(1);
  });
});

describe("tutanak PDF ve yürütülmüş imha", () => {
  it("PDF yapısı: başlık, xref ofsetleri ve EOF doğru", () => {
    const bytes = buildPdf(["Satır bir", "ĞğİıŞş ve Çç Öö Üü", "(parantez) \\ ters eğik"]);
    const text = Buffer.from(bytes).toString("latin1");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    const sx = /startxref\n(\d+)\n/.exec(text);
    expect(sx).not.toBeNull();
    const xrefAt = Number(sx?.[1]);
    expect(text.slice(xrefAt, xrefAt + 4)).toBe("xref");
    const entries = [...text.matchAll(/(\d{10}) 00000 n \n/g)].map((m) => Number(m[1]));
    expect(entries.length).toBeGreaterThan(3);
    // entries[i] nesne (i+1)'e karşılık gelir (nesne 0 serbest girişidir).
    entries.forEach((off, i) => {
      const label = `${String(i + 1)} 0 obj`;
      expect(text.slice(off, off + label.length)).toBe(label);
    });
  });

  it("tutanak satırları içeriksiz manifest alanlarını içerir", () => {
    const lines = certificateLines({ reviewId: "r1", documentNumber: "BLG-1", counts: { documents: 1 } }, "a".repeat(64));
    expect(lines.join("\n")).toContain("a".repeat(64));
    expect(lines.join("\n")).toContain("Yok (dijital imha)");
  });

  it("yürütülmüş imha: tutanak yalnız yetkiliye, audit'li ve geçerli PDF", async () => {
    const d = await makeDoc("cert-doc");
    const pf = await db.prisma.retentionProfile.findFirstOrThrow({ where: { id: profV } });
    expect(pf.verifiedByLegal).toBe(true);
    await assignRetentionProfile(db.prisma, { actor: await ctx(recA), now: NOW, correlationId: cid("as"), documentId: d.documentId, profileId: profV, expectedRowVersion: (await db.prisma.document.findUniqueOrThrow({ where: { id: d.documentId } })).rowVersion });
    await recordRetentionTriggerEvent(db.prisma, { actor: await ctx(recA), now: NOW, correlationId: cid("tg"), documentId: d.documentId, eventDate: "2020-01-01", note: "Tetikleyici" });
    await scanDispositionCandidates(db.prisma, { now: NOW, correlationId: cid("scan") });
    const review = await db.prisma.dispositionReview.findFirstOrThrow({ where: { documentId: d.documentId }, orderBy: { createdAt: "desc" } });
    const dec = async (who: string) => {
      const r = await db.prisma.dispositionReview.findUniqueOrThrow({ where: { id: review.id }, select: { rowVersion: true } });
      return decideDispositionReview(db.prisma, { actor: await ctx(who), now: NOW, correlationId: cid("dc"), reviewId: review.id, expectedRowVersion: r.rowVersion, decision: "APPROVE", reason: "Onay" });
    };
    await dec(apprB);
    await dec(apprC);
    const res = await runDispositionWorker(db.prisma, { storage, now: NOW, correlationId: cid("w"), reviewId: review.id });
    expect(res[0]?.status).toBe("EXECUTED");

    await expect(buildDisposalCertificate(db.prisma, { actor: await ctx(plain), now: NOW, correlationId: cid("ct"), reviewId: review.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listExecutedDispositions(db.prisma, { actor: await ctx(plain), now: NOW })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const list = await listExecutedDispositions(db.prisma, { actor: await ctx(admin), now: NOW });
    const row = must(list.find((x) => x.reviewId === review.id), "yürütülmüş satır");
    expect(JSON.stringify(row)).not.toContain("Başlık cert-doc");

    const cert = await buildDisposalCertificate(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("ct"), reviewId: review.id });
    const head = Buffer.from(cert.bytes).subarray(0, 8).toString("latin1");
    expect(head.startsWith("%PDF-1.4")).toBe(true);
    expect(cert.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(cert.filename).toBe(`imha-tutanagi-${review.id}.pdf`);
    const audit = await db.prisma.auditEvent.findFirst({ where: { eventType: "DISPOSAL_CERTIFICATE_EXPORTED", targetId: review.id } });
    expect(audit).not.toBeNull();
    const payload = audit?.afterSummary as Prisma.JsonObject | null;
    expect(payload?.certificateSha256).toBe(cert.sha256);
  });
});
