// Geliştirme/E2E için YAPILANDIRMA verisi: test kullanıcıları (roller ve kapsamlarıyla), birim, tüzel kişi,
// karşı taraf ve SOZLESME belge türü. Belge veya sözleşme KAYDI oluşturmaz; onları E2E testleri gerçek akışla üretir.
// Kullanım: EKOS_DEV_PASSWORD=... DATABASE_URL=... npx tsx scripts/dev-users.ts
import { argon2Hash, argon2Verify } from "./argon.js";
import { PrismaClient } from "@prisma/client";
import { createLocalUser } from "../src/seed/create-user.js";

const password = process.env.EKOS_DEV_PASSWORD ?? "";
if (password.length < 12) throw new Error("EKOS_DEV_PASSWORD en az 12 karakter olmalı");
const prisma = new PrismaClient();
const hasher = { hash: argon2Hash, verify: argon2Verify };

try {
  const NOW = new Date();
  const d1 = await prisma.department.upsert({ where: { code: "HUKUK" }, update: {}, create: { code: "HUKUK", name: "Hukuk" } });
  const d2 = await prisma.department.upsert({ where: { code: "SATINALMA" }, update: {}, create: { code: "SATINALMA", name: "Satınalma" } });
  if (!(await prisma.legalEntity.findFirst({ where: { name: "EKOS Test A.Ş." } }))) {
    await prisma.legalEntity.create({ data: { name: "EKOS Test A.Ş.", countryCode: "TR", isActive: true, updatedAt: NOW } as never });
  }
  if ((await prisma.counterparty.count({ where: { officialName: "Örnek Tedarikçi Ltd. Şti." } })) === 0) {
    await prisma.counterparty.create({ data: { officialName: "Örnek Tedarikçi Ltd. Şti.", countryCode: "TR", status: "ACTIVE", updatedAt: NOW } as never });
  }
  await prisma.documentType.upsert({
    where: { code: "SOZLESME" },
    update: {},
    create: { code: "SOZLESME", name: "Sözleşme", defaultConfidentiality: "CONFIDENTIAL", requiredMetadataKeys: ["counterpartyId"], updatedAt: NOW } as never,
  });
  await prisma.metadataDefinition.upsert({ where: { key: "counterpartyId" }, update: {}, create: { key: "counterpartyId", label: "Karşı taraf", dataType: "REFERENCE", enumValues: [] } as never });

  const users = [
    { email: "yonetici@ekos.test", displayName: "Sistem Yöneticisi", roleCode: "PLATFORM_ADMIN", organizationWide: true },
    { email: "onayci@ekos.test", displayName: "Onaycı Hukuk", roleCode: "APPROVER", organizationWide: true },
    { email: "denetci@ekos.test", displayName: "Hukuk Denetçisi", roleCode: "INTERNAL_AUDITOR", scope: { departmentIds: [d1.id] } },
    { email: "kullanici@ekos.test", displayName: "Satınalma Kullanıcısı", roleCode: "DEPARTMENT_USER", scope: { departmentIds: [d2.id] } },
    { email: "sozlesme@ekos.test", displayName: "Sözleşme Yöneticisi", roleCode: "CONTRACT_MANAGER", organizationWide: true },
    { email: "guvenlik@ekos.test", displayName: "Güvenlik Denetçisi", roleCode: "SECURITY_AUDITOR", organizationWide: true },
  ] as const;
  const created: string[] = [];
  for (const u of users) {
    const exists = await prisma.user.findUnique({ where: { email: u.email } });
    if (exists) { created.push(`mevcut: ${u.email}`); continue; }
    const r = await createLocalUser(prisma, hasher, { email: u.email, displayName: u.displayName, password, roleCode: u.roleCode, scope: "scope" in u ? u.scope : undefined, organizationWide: "organizationWide" in u ? u.organizationWide : undefined });
    created.push(`oluşturuldu: ${u.email} (${r.userId})`);
  }
  // Sözleşme onay matrisi (yapılandırma): yayımlı sürüm yoksa, aktif bir onaycıyla tek adımlı matris yayımlanır.
  // Öneren (sözleşme yöneticisi) ile onaycı farklı kişidir; öz onay engellenir (R-WF-03).
  const approver = await prisma.user.findUnique({ where: { email: "onayci@ekos.test" }, select: { id: true, status: true } });
  if (approver && approver.status === "ACTIVE") {
    const { appendAudit } = await import("../src/audit.js");
    const { uuidv7 } = await import("@ekos/core");
    const CODE = "CONTRACT_APPROVAL";
    const published = await prisma.workflowDefinitionVersion.count({ where: { status: "PUBLISHED", definitionRef: { code: CODE } } });
    if (published === 0) {
      await prisma.$transaction(async (tx) => {
        const def = (await tx.workflowDefinition.findUnique({ where: { code: CODE } })) ??
          (await tx.workflowDefinition.create({ data: { code: CODE, name: "Sözleşme onayı", updatedAt: NOW } }));
        const last = await tx.workflowDefinitionVersion.findFirst({ where: { definitionId: def.id }, orderBy: { version: "desc" } });
        const version = (last?.version ?? 0) + 1;
        const steps = [{ orderIndex: 1, approverIds: [approver.id], requiredApprovals: 1 }];
        const created2 = await tx.workflowDefinitionVersion.create({
          data: { id: uuidv7(), definitionId: def.id, version, status: "PUBLISHED", definition: { steps }, publishedAt: new Date() },
        });
        await appendAudit(tx, {
          actorType: "SYSTEM", actorId: null, eventType: "WORKFLOW_MATRIX_PUBLISHED", targetType: "WorkflowDefinitionVersion",
          targetId: created2.id, targetVersion: version, outcome: "SUCCESS", correlationId: `dev-matrix-${created2.id}`, afterSummary: { steps: 1 },
        });
        created.push(`yayımlandı: ${CODE} v${String(version)} (onaycı: onayci@ekos.test)`);
      });
    }
  }
  process.stdout.write(created.join("\n") + "\n");
} finally {
  await prisma.$disconnect();
}
