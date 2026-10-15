// Fiziksel arşiv (Faz 2, madde 11). Dijital kopya fiziksel aslın yerine geçmez; asıl kontrolü ayrıca kayda geçilir.
// Konum değişince "asıl doğrulandı" bayrağı sıfırlanır (eski doğrulama yeni konum için geçerli değildir).
import type { ActorContext } from "@ekos/core";
import type { PrismaClient } from "@prisma/client";
import { appendAudit } from "../audit.js";
import { guardDocument } from "./guard.js";
import { DomainError } from "./shared.js";
import { checkRowVersion } from "@ekos/core";

const PERM = "document.archive";

export interface PhysicalLocationInput {
  readonly box?: string | null;
  readonly file?: string | null;
  readonly shelf?: string | null;
  readonly custodianId?: string | null;
}

export async function setPhysicalLocation(
  prisma: PrismaClient,
  input: { readonly actor: ActorContext; readonly now: Date; readonly correlationId: string; readonly documentId: string; readonly expectedRowVersion: number; readonly location: PhysicalLocationInput },
): Promise<{ rowVersion: number }> {
  await guardDocument(prisma, { actor: input.actor, now: input.now, documentId: input.documentId, permission: PERM });
  return prisma.$transaction(async (tx) => {
    const cur = await tx.physicalArchiveLocation.findUnique({ where: { documentId: input.documentId } });
    const data = {
      box: input.location.box ?? null,
      file: input.location.file ?? null,
      shelf: input.location.shelf ?? null,
      custodianId: input.location.custodianId ?? null,
    };
    if (!cur) {
      if (input.expectedRowVersion !== 0) throw new DomainError("VERSION_CONFLICT", "Fiziksel konum zaten var");
      const created = await tx.physicalArchiveLocation.create({
        data: { documentId: input.documentId, ...data, originalVerified: false, createdBy: input.actor.userId, updatedBy: input.actor.userId },
      });
      await audit(tx, input, "PHYSICAL_LOCATION_SET", null);
      return { rowVersion: created.rowVersion };
    }
    const rv = checkRowVersion(cur.rowVersion, input.expectedRowVersion);
    if (!rv.ok) throw new DomainError("VERSION_CONFLICT", "Fiziksel konum başka biri tarafından değiştirildi");
    const changed = cur.box !== data.box || cur.file !== data.file || cur.shelf !== data.shelf || cur.custodianId !== data.custodianId;
    const updated = await tx.physicalArchiveLocation.update({
      where: { id: cur.id, rowVersion: input.expectedRowVersion },
      data: {
        ...data,
        ...(changed ? { originalVerified: false, verifiedAt: null, verifiedBy: null } : {}),
        rowVersion: rv.nextRowVersion,
        updatedBy: input.actor.userId,
      },
    }).catch(conflictOrThrow);
    await audit(tx, input, "PHYSICAL_LOCATION_SET", changed ? "VERIFICATION_RESET" : null);
    return { rowVersion: updated.rowVersion };
  });
}

export async function verifyOriginal(
  prisma: PrismaClient,
  input: { readonly actor: ActorContext; readonly now: Date; readonly correlationId: string; readonly documentId: string; readonly expectedRowVersion: number },
): Promise<void> {
  await guardDocument(prisma, { actor: input.actor, now: input.now, documentId: input.documentId, permission: PERM });
  await prisma.$transaction(async (tx) => {
    const cur = await tx.physicalArchiveLocation.findUnique({ where: { documentId: input.documentId } });
    if (!cur) throw new DomainError("NOT_FOUND", "Fiziksel konum kayıtlı değil");
    const rv = checkRowVersion(cur.rowVersion, input.expectedRowVersion);
    if (!rv.ok) throw new DomainError("VERSION_CONFLICT", "Fiziksel konum başka biri tarafından değiştirildi");
    await tx.physicalArchiveLocation.update({
      where: { id: cur.id, rowVersion: input.expectedRowVersion },
      data: { originalVerified: true, verifiedAt: input.now, verifiedBy: input.actor.userId, rowVersion: rv.nextRowVersion, updatedBy: input.actor.userId },
    }).catch(conflictOrThrow);
    await audit(tx, input, "PHYSICAL_ORIGINAL_VERIFIED", null);
  });
}

async function audit(
  tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
  input: { readonly actor: ActorContext; readonly correlationId: string; readonly documentId: string },
  eventType: string,
  reason: string | null,
): Promise<void> {
  await appendAudit(tx, {
    actorType: "USER",
    actorId: input.actor.userId,
    eventType,
    targetType: "DOCUMENT",
    targetId: input.documentId,
    outcome: "SUCCESS",
    reason,
    correlationId: input.correlationId,
  });
}

/** Koşullu güncelleme (WHERE rowVersion = beklenen) eşleşmezse Prisma P2025 gelir: bu bir sürüm çakışmasıdır. */
function conflictOrThrow(e: unknown): never {
  if (typeof e === "object" && e !== null && "code" in e && e.code === "P2025") {
    throw new DomainError("VERSION_CONFLICT", "Fiziksel konum başka biri tarafından değiştirildi");
  }
  throw e;
}
