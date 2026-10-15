// Önizleme (Faz 2, madde 5). Yalnızca taraması CLEAN ve objects/ altındaki dosya verilir.
// Karantina/INFECTED dosya asla servis edilmez. Her başarılı önizleme denetime yazılır.
import type { ActorContext } from "@ekos/core";
import type { ObjectStoragePort } from "@ekos/core";
import type { PrismaClient } from "@prisma/client";
import { appendAudit } from "../audit.js";
import { guardDocument } from "./guard.js";
import { DomainError } from "./shared.js";

export interface PreviewResult {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly fileName: string;
  readonly sha256: string;
}

export async function getDocumentPreview(
  deps: { prisma: PrismaClient; storage: ObjectStoragePort },
  input: { readonly actor: ActorContext; readonly now: Date; readonly documentId: string; readonly correlationId: string },
): Promise<PreviewResult> {
  const doc = await guardDocument(deps.prisma, { actor: input.actor, now: input.now, documentId: input.documentId, permission: "document.preview" });
  if (!doc.currentVersionId) throw new DomainError("FILE_NOT_CLEAN", "Sürüm yok");
  const version = await deps.prisma.documentVersion.findUniqueOrThrow({
    where: { id: doc.currentVersionId },
    include: { fileObject: true },
  });
  const file = version.fileObject;
  if (!file || file.scanStatus !== "CLEAN" || file.storagePrefix !== "objects" || doc.ingestStatus === "REJECTED") {
    throw new DomainError("FILE_NOT_CLEAN", "Dosya önizleme için hazır değil");
  }
  const bytes = await deps.storage.get(file.storageKey);
  await deps.prisma.$transaction((tx) =>
    appendAudit(tx, {
      actorType: "USER",
      actorId: input.actor.userId,
      eventType: "DOCUMENT_PREVIEWED",
      targetType: "DOCUMENT",
      targetId: doc.id,
      targetVersion: version.versionNumber,
      outcome: "SUCCESS",
      correlationId: input.correlationId,
    }),
  );
  return { bytes, mimeType: file.mimeType, fileName: file.originalFileName, sha256: file.sha256 };
}
