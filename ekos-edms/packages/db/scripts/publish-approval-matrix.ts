// Sözleşme onay matrisini yayımlar (R-WF-02). Yönetici CLI'si; arayüz yoktur.
// Girdi JSON: { "steps": [ { "approverEmails": ["a@x.com","b@x.com"], "requiredApprovals": 1 }, ... ] }
// Kullanım: DATABASE_URL=... EKOS_MATRIX_FILE=matris.json npx tsx scripts/publish-approval-matrix.ts
// Kurallar: her adımda en az bir AKTİF onaycı; gereken onay sayısı onaycı sayısını aşamaz. Önceki yayımlı sürüm emekliye ayrılır.
// Başlamış örnekler kendi sürümlerine sabitlidir (R-WF-01).
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { checkApprovalMatrix, uuidv7, type MatrixStep } from "@ekos/core";
import { appendAudit } from "../src/audit.js";
import { CONTRACT_APPROVAL_DEFINITION } from "../src/contracts/lifecycle.js";

const file = process.env.EKOS_MATRIX_FILE;
if (!file) throw new Error("EKOS_MATRIX_FILE zorunlu");
const input = JSON.parse(readFileSync(file, "utf8")) as { steps?: { approverEmails?: string[]; requiredApprovals?: number }[] };
const prisma = new PrismaClient();
try {
  const emailsByStep = (input.steps ?? []).map((s) => (s.approverEmails ?? []).map((e) => e.trim().toLowerCase()));
  const allEmails = [...new Set(emailsByStep.flat())];
  const users = await prisma.user.findMany({ where: { email: { in: allEmails }, status: "ACTIVE" }, select: { id: true, email: true } });
  const idByEmail = new Map(users.map((u) => [u.email, u.id]));
  const missing = allEmails.filter((e) => !idByEmail.has(e));
  if (missing.length > 0) throw new Error(`Aktif kullanıcı bulunamadı: ${missing.join(", ")}`);

  const matrix: MatrixStep[] = (input.steps ?? []).map((s, i) => ({
    orderIndex: i + 1,
    approverIds: (s.approverEmails ?? []).map((e) => idByEmail.get(e.trim().toLowerCase()) as string),
    requiredApprovals: s.requiredApprovals ?? 1,
  }));
  const check = checkApprovalMatrix(matrix);
  if (!check.ok) throw new Error(`Matris geçersiz: ${check.violation}`);

  const result = await prisma.$transaction(async (tx) => {
    const def = (await tx.workflowDefinition.findUnique({ where: { code: CONTRACT_APPROVAL_DEFINITION } })) ??
      (await tx.workflowDefinition.create({ data: { code: CONTRACT_APPROVAL_DEFINITION, name: "Sözleşme onayı", updatedAt: new Date() } }));
    const last = await tx.workflowDefinitionVersion.findFirst({ where: { definitionId: def.id }, orderBy: { version: "desc" } });
    const version = (last?.version ?? 0) + 1;
    await tx.workflowDefinitionVersion.updateMany({ where: { definitionId: def.id, status: "PUBLISHED" }, data: { status: "RETIRED" } });
    const created = await tx.workflowDefinitionVersion.create({
      data: {
        id: uuidv7(),
        definitionId: def.id,
        version,
        status: "PUBLISHED",
        definition: { steps: matrix.map((s) => ({ orderIndex: s.orderIndex, approverIds: [...s.approverIds], requiredApprovals: s.requiredApprovals })) },
        publishedAt: new Date(),
      },
    });
    await appendAudit(tx, {
      actorType: "SYSTEM",
      actorId: null,
      eventType: "WORKFLOW_MATRIX_PUBLISHED",
      targetType: "WorkflowDefinitionVersion",
      targetId: created.id,
      targetVersion: version,
      outcome: "SUCCESS",
      correlationId: `matrix-${created.id}`,
      afterSummary: { steps: matrix.length },
    });
    return { versionId: created.id, version };
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await prisma.$disconnect();
}
