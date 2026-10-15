// Belge erişim koruyucusu: önce GÖRÜNÜRLÜK (sorgu içi filtre), sonra EYLEM izni (core authorize).
// Görünmeyen belge → NOT_FOUND (varlık sızmaz). Görünür ama izin yok → FORBIDDEN (403).
import { authorize, deniedHttpStatus, type AclEntry, type ActorContext } from "@ekos/core";
import type { PrismaClient } from "@prisma/client";
import { documentVisibilitySql } from "./visibility.js";
import { DomainError } from "./shared.js";

export interface GuardedDocument {
  readonly id: string;
  readonly number: string;
  readonly title: string;
  readonly departmentId: string | null;
  readonly typeId: string;
  readonly confidentiality: "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED" | "HIGHLY_RESTRICTED";
  readonly ingestStatus: string;
  readonly currentVersionId: string | null;
  readonly rowVersion: number;
}

export async function guardDocument(
  prisma: PrismaClient,
  input: { readonly actor: ActorContext; readonly now: Date; readonly documentId: string; readonly permission: string },
): Promise<GuardedDocument> {
  const visible = await prisma.$queryRaw<{ id: string }[]>`
    SELECT d."id" FROM "Document" d
    WHERE d."id" = ${input.documentId}::uuid AND ${documentVisibilitySql(input.actor, input.now)}`;
  // Kırılma-cam: bu belge ve bu izin için geçerli bir kayıt varsa görünürlük kapısı açılır; eylem izni yine authorize ile doğrulanır.
  const bgCovers = input.actor.breakGlass.some(
    (g) =>
      g.resourceId === input.documentId &&
      g.status === "APPROVED" &&
      g.permissions.includes(input.permission) &&
      g.requestedById === input.actor.userId &&
      g.approvedById !== null &&
      g.approvedById !== input.actor.userId &&
      (!g.startsAt || g.startsAt.getTime() <= input.now.getTime()) &&
      !!g.expiresAt && g.expiresAt.getTime() > input.now.getTime(),
  );
  if (visible.length === 0 && !bgCovers) throw new DomainError("NOT_FOUND");

  const doc = await prisma.document.findUniqueOrThrow({
    where: { id: input.documentId },
    select: {
      id: true, number: true, title: true, departmentId: true, typeId: true, confidentiality: true,
      ingestStatus: true, currentVersionId: true, rowVersion: true,
    },
  });

  const acls = await prisma.documentAcl.findMany({ where: { documentId: doc.id } });
  const roleIds = [...new Set(acls.map((a) => a.subjectRoleId).filter((x): x is string => x !== null))];
  const roles = roleIds.length > 0 ? await prisma.role.findMany({ where: { id: { in: roleIds } }, select: { id: true, code: true } }) : [];
  const roleCode = new Map(roles.map((r) => [r.id, r.code]));
  const acl: AclEntry[] = [];
  for (const a of acls) {
    const subject = a.subjectUserId
      ? ({ type: "USER", id: a.subjectUserId } as const)
      : a.subjectGroupId
        ? ({ type: "GROUP", id: a.subjectGroupId } as const)
        : a.subjectRoleId && roleCode.has(a.subjectRoleId)
          ? ({ type: "ROLE", id: roleCode.get(a.subjectRoleId) ?? "" } as const)
          : null;
    if (subject) acl.push({ effect: a.effect, permissionCode: a.permissionCode, subject });
  }

  const authInput = {
    actor: input.actor,
    permission: input.permission,
    resource: {
      id: doc.id,
      kind: "DOCUMENT" as const,
      departmentId: doc.departmentId,
      documentTypeId: doc.typeId,
      confidentiality: doc.confidentiality,
    },
    acl,
    now: input.now,
  };
  const result = authorize(authInput);
  if (!result.allowed) {
    // Görünürlük: document.view_metadata. Görünür ama eylem izni yoksa 403, değilse 404.
    const status = deniedHttpStatus(authInput, "document.view_metadata");
    throw new DomainError(status === 404 ? "NOT_FOUND" : "FORBIDDEN");
  }
  return doc;
}
