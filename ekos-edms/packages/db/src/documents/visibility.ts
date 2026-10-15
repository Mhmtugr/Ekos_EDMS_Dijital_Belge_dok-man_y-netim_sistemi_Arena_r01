// Sorgu içi yetki filtresi (Faz 2, madde 6). Anlam, core authorize() ile aynıdır:
//  - DENY (ACL) her zaman önceliklidir.
//  - Aktif, süresi dolmamış, iptal edilmemiş üyelik + kapsam kesişimi + gizlilik tavanı → görünür.
//  - Kapsamda counterparty/project kısıtı varsa belge-düzeyinde eşleşme yoktur → bu üyelik görünürlük VERMEZ (muhafazakâr).
//  - Açık ACL ALLOW → görünür.
import { Prisma } from "@prisma/client";
import { CONFIDENTIALITY_LEVELS, type ActorContext, type MembershipScope } from "@ekos/core";

const LIST_PERMISSION = "document.list";

function isActiveGrant(m: { validFrom?: Date | null; validUntil?: Date | null; revokedAt?: Date | null }, now: Date): boolean {
  if (m.revokedAt) return false;
  if (m.validFrom && m.validFrom.getTime() > now.getTime()) return false;
  if (m.validUntil && m.validUntil.getTime() <= now.getTime()) return false;
  return true;
}

function scopeClause(scope: MembershipScope): Prisma.Sql | null {
  // Muhafazakâr: belge-düzeyinde karşılığı olmayan kısıtlar görünürlük vermez.
  if ((scope.counterpartyIds?.length ?? 0) > 0 || (scope.projectIds?.length ?? 0) > 0) return null;
  const parts: Prisma.Sql[] = [];
  if ((scope.departmentIds?.length ?? 0) > 0) {
    parts.push(Prisma.sql`d."departmentId" = ANY(${scope.departmentIds}::uuid[])`);
  }
  if ((scope.documentTypeIds?.length ?? 0) > 0) {
    parts.push(Prisma.sql`d."typeId" = ANY(${scope.documentTypeIds}::uuid[])`);
  }
  if (scope.maxConfidentiality) {
    const max = CONFIDENTIALITY_LEVELS.indexOf(scope.maxConfidentiality);
    const allowed = CONFIDENTIALITY_LEVELS.slice(0, max + 1) as string[];
    parts.push(Prisma.sql`d."confidentiality" = ANY(${allowed}::"ConfidentialityLevel"[])`);
  }
  if (scope.documentId) {
    parts.push(Prisma.sql`d."id" = ${scope.documentId}::uuid`);
  }
  if (parts.length === 0) return Prisma.sql`TRUE`; // kısıt yok
  return Prisma.join(parts, " AND ");
}

/**
 * Belge tablosu takma adı "d" olan bir SQL koşulu üretir. Hiç yetki yoksa FALSE.
 */
export function documentVisibilitySql(actor: ActorContext, now: Date): Prisma.Sql {
  if (actor.status !== "ACTIVE") return Prisma.sql`FALSE`;

  const allowClauses: Prisma.Sql[] = [];
  for (const m of actor.memberships) {
    if (!isActiveGrant(m, now) || !m.permissions.includes(LIST_PERMISSION)) continue;
    const c = scopeClause(m.scope);
    if (c) allowClauses.push(Prisma.sql`(${c})`);
  }

  // ACL rol öznesi: DocumentAcl.subjectRoleId → Role.code; core ile aynı anlam (rol kodu).
  const roleCodes = [...new Set(actor.memberships.map((m) => m.roleCode))];
  const subjectMatch = Prisma.sql`(
      a."subjectUserId" = ${actor.userId}::uuid
      OR a."subjectGroupId" = ANY(${actor.groupIds}::uuid[])
      OR a."subjectRoleId" IN (SELECT r."id" FROM "Role" r WHERE r."code" = ANY(${roleCodes}))
    )`;
  const aclAllow = Prisma.sql`EXISTS (
      SELECT 1 FROM "DocumentAcl" a
      WHERE a."documentId" = d."id" AND a."permissionCode" = ${LIST_PERMISSION}
        AND a."effect" = 'ALLOW' AND ${subjectMatch})`;
  const aclDeny = Prisma.sql`EXISTS (
      SELECT 1 FROM "DocumentAcl" a
      WHERE a."documentId" = d."id" AND a."permissionCode" = ${LIST_PERMISSION}
        AND a."effect" = 'DENY' AND ${subjectMatch})`;

  const grantAny = allowClauses.length > 0
    ? Prisma.sql`(${Prisma.join(allowClauses, " OR ")}) OR ${aclAllow}`
    : aclAllow;
  return Prisma.sql`((${grantAny}) AND NOT (${aclDeny}))`;
}

