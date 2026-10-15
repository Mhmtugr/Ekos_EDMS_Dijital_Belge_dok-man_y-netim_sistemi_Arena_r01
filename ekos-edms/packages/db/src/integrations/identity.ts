// Entra ID grup/rol eşlemesi (IdentityProviderMapping, Faz 6 madde 2).
// Politika (ADR notu): YALNIZCA EKLEME. IdP'de grup kaldırılınca otomatik yetki geri alınmaz (yanlış kapatma riskine karşı);
// geri alma yönetici işlemidir. Grup claim'i overage ise (null) eşleme UYGULANMAZ ve denetime yazılır.
import type { PrismaClient } from "@prisma/client";
import { DomainError } from "../documents/shared.js";
import { appendAudit } from "../audit.js";

export async function upsertIdentityMapping(
  prisma: PrismaClient,
  input: { readonly providerKey: string; readonly externalGroupId: string; readonly roleId: string; readonly groupId: string | null; readonly actorId: string; readonly correlationId: string },
): Promise<{ readonly id: string; readonly created: boolean }> {
  if (!/^[A-Za-z0-9-]{8,200}$/.test(input.externalGroupId)) throw new DomainError("VALIDATION_FAILED", "Dış grup kimliği geçersiz biçimde");
  const role = await prisma.role.findUnique({ where: { id: input.roleId }, select: { id: true } });
  if (!role) throw new DomainError("NOT_FOUND", "Rol bulunamadı");
  if (input.groupId) {
    const g = await prisma.group.findUnique({ where: { id: input.groupId }, select: { id: true } });
    if (!g) throw new DomainError("NOT_FOUND", "Grup bulunamadı");
  }
  const existing = await prisma.identityProviderMapping.findFirst({
    where: { providerKey: input.providerKey, externalGroupId: input.externalGroupId, roleId: input.roleId },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };
  return prisma.$transaction(async (tx) => {
    const row = await tx.identityProviderMapping.create({
      data: { providerKey: input.providerKey, externalGroupId: input.externalGroupId, roleId: input.roleId, groupId: input.groupId, createdBy: input.actorId },
      select: { id: true },
    });
    await appendAudit(tx, {
      actorType: "USER",
      actorId: input.actorId,
      eventType: "idp.mapping_created",
      targetType: "IdentityProviderMapping",
      targetId: row.id,
      outcome: "SUCCESS",
      correlationId: input.correlationId,
      afterSummary: { providerKey: input.providerKey, roleId: input.roleId, groupLinked: input.groupId !== null },
    });
    return { id: row.id, created: true };
  });
}

export type GroupSyncResult =
  | { readonly status: "SKIPPED_OVERAGE" }
  | { readonly status: "APPLIED"; readonly addedMemberships: number; readonly addedGroupMemberships: number };

export async function applyIdentityGroups(
  prisma: PrismaClient,
  input: { readonly userId: string; readonly providerKey: string; readonly externalGroups: readonly string[] | null; readonly correlationId: string },
): Promise<GroupSyncResult> {
  if (input.externalGroups === null) {
    await prisma.$transaction((tx) =>
      appendAudit(tx, {
        actorType: "SYSTEM",
        actorId: null,
        eventType: "idp.group_sync",
        targetType: "User",
        targetId: input.userId,
        outcome: "SUCCESS",
        correlationId: input.correlationId,
        afterSummary: { providerKey: input.providerKey, skipped: "GROUP_OVERAGE" },
      }),
    );
    return { status: "SKIPPED_OVERAGE" };
  }
  const mappings = input.externalGroups.length === 0
    ? []
    : await prisma.identityProviderMapping.findMany({
        where: { providerKey: input.providerKey, externalGroupId: { in: [...new Set(input.externalGroups)] } },
        select: { roleId: true, groupId: true },
      });
  return prisma.$transaction(async (tx) => {
    let addedMemberships = 0;
    let addedGroupMemberships = 0;
    for (const m of mappings) {
      const has = await tx.membership.findFirst({ where: { userId: input.userId, roleId: m.roleId, groupId: null, revokedAt: null }, select: { id: true } });
      if (!has) {
        // Kapsam boş = kısıt yok; eşleme yöneticisi rolü bilerek tanımlar (UI'da uyarılır).
        await tx.membership.create({
          data: {
            userId: input.userId,
            roleId: m.roleId,
            departmentIds: [],
            documentTypeIds: [],
            counterpartyIds: [],
            projectIds: [],
          },
        });
        addedMemberships += 1;
      }
      if (m.groupId) {
        const r = await tx.groupMember.createMany({ data: [{ groupId: m.groupId, userId: input.userId }], skipDuplicates: true });
        addedGroupMemberships += r.count;
      }
    }
    await appendAudit(tx, {
      actorType: "SYSTEM",
      actorId: null,
      eventType: "idp.group_sync",
      targetType: "User",
      targetId: input.userId,
      outcome: "SUCCESS",
      correlationId: input.correlationId,
      afterSummary: { providerKey: input.providerKey, matched: mappings.length, addedMemberships, addedGroupMemberships },
    });
    return { status: "APPLIED", addedMemberships, addedGroupMemberships };
  });
}
