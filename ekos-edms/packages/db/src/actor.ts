// Veritabanından yetki bağlamı yükler (core authorize() girdisi). Eksik ilişki = yetki yok (deny-by-default).
import type { PrismaClient } from "@prisma/client";
import type { ActorContext, BreakGlassView, MembershipGrant, MembershipScope } from "@ekos/core";

export async function loadActorContext(prisma: PrismaClient, userId: string, now: Date = new Date()): Promise<ActorContext> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, status: true } });
  if (!user) {
    return { userId, status: "DISABLED", groupIds: [], memberships: [], breakGlass: [] };
  }
  const [groups, memberships] = await Promise.all([
    prisma.groupMember.findMany({ where: { userId }, select: { groupId: true } }),
    prisma.membership.findMany({
      where: {
        OR: [{ userId }, { group: { members: { some: { userId } } } }],
      },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    }),
  ]);

  const grants: MembershipGrant[] = memberships.map((m) => {
    const scope: MembershipScope = {
      departmentIds: m.departmentIds,
      documentTypeIds: m.documentTypeIds,
      counterpartyIds: m.counterpartyIds,
      projectIds: m.projectIds,
      maxConfidentiality: m.maxConfidentiality,
      documentId: m.documentId,
    };
    return {
      membershipId: m.id,
      roleCode: m.role.code,
      permissions: m.role.permissions.map((rp) => rp.permission.code),
      scope,
      validFrom: m.validFrom,
      validUntil: m.validUntil,
      revokedAt: m.revokedAt,
    };
  });

  // Kırılma-cam (Faz 4): yalnız talep edene ait, onaylanmış, süresi dolmamış kayıtlar yüklenir.
  // Onay ve süre kontrolü authorize() içinde yeniden yapılır (savunma derinliği).
  const bgRows = await prisma.breakGlassGrant.findMany({
    where: {
      requesterId: userId,
      status: "APPROVED",
      expiresAt: { gt: now },
      permissionCode: { not: null },
    },
  });
  const breakGlass: BreakGlassView[] = bgRows.map((g) => ({
    grantId: g.id,
    resourceId: g.subjectId,
    permissions: g.permissionCode ? [g.permissionCode] : [],
    requestedById: g.requesterId,
    approvedById: g.approverId,
    startsAt: g.startsAt,
    expiresAt: g.expiresAt,
    status: "APPROVED",
  }));

  return {
    userId,
    status: user.status,
    groupIds: groups.map((g) => g.groupId),
    memberships: grants,
    breakGlass,
  };
}
