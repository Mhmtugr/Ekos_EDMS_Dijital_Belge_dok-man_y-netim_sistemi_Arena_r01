// Belge oluşturma ve sürümleme (Faz 2, madde 3). Yeni içerik = yeni sürüm; önceki sürüm salt-okunur kilitlenir.
import { checkRowVersion, createNewVersion as coreNewVersion, uuidv7, CONFIDENTIALITY_LEVELS, type ConfidentialityLevel, type VersionRecord } from "@ekos/core";
import type { PrismaClient } from "@prisma/client";
import { appendAudit } from "../audit.js";
import { onScanVerdict } from "./pipeline.js";
import { DomainError, buildSearchText, nextDocumentNumber, parseMetadataValues, requireActiveType, type MetadataInput } from "./shared.js";

export interface CreateDocumentInput {
  readonly actorId: string;
  readonly correlationId: string;
  readonly typeCode: string;
  readonly title: string;
  readonly metadata: MetadataInput;
  readonly departmentId?: string | null;
  readonly confidentiality?: ConfidentialityLevel;
  readonly fileObjectId?: string | null;
  readonly now?: Date;
}

export async function createDocument(prisma: PrismaClient, input: CreateDocumentInput): Promise<{ documentId: string; number: string; ingestStatus: string }> {
  return prisma.$transaction((tx) => createDocumentInTx(tx, input));
}

/** Dış işlem içinde kullanılır (toplu içe aktarma satır işlemi). */
export async function createDocumentInTx(tx: Tx, input: CreateDocumentInput): Promise<{ documentId: string; number: string; ingestStatus: string }> {
  const now = input.now ?? new Date();
  {
    const type = await requireActiveType(tx, input.typeCode);
    const title = input.title.trim();
    if (title.length === 0) throw new DomainError("REQUIRED_METADATA_MISSING", "Başlık zorunludur");

    for (const key of type.requiredMetadataKeys) {
      if (key === "title") continue;
      if ((input.metadata[key] ?? "").trim() === "") throw new DomainError("REQUIRED_METADATA_MISSING", `Zorunlu alan: ${key}`);
    }

    // Gizlilik türün asgarisinin altına düşemez (ör. İK belgesi HIGHLY_RESTRICTED).
    const confidentiality = input.confidentiality ?? type.defaultConfidentiality;
    if (CONFIDENTIALITY_LEVELS.indexOf(confidentiality) < CONFIDENTIALITY_LEVELS.indexOf(type.defaultConfidentiality)) {
      throw new DomainError("METADATA_INVALID", "Gizlilik, tür asgarisinin altında olamaz");
    }

    const metaRows = await parseMetadataValues(tx, input.metadata);
    const number = await nextDocumentNumber(tx, type.code, now.getUTCFullYear());
    const documentId = uuidv7(now.getTime());
    await tx.document.create({
      data: {
        id: documentId,
        number,
        title,
        typeId: type.id,
        departmentId: input.departmentId ?? null,
        ownerId: input.actorId,
        confidentiality,
        ingestStatus: "QUARANTINED",
        lifecycleProfile: "GENERAL",
        generalStatus: "DRAFT",
        searchText: buildSearchText(title, metaRows.map((m) => m.searchable)),
        createdBy: input.actorId,
        updatedBy: input.actorId,
      },
    });
    if (metaRows.length > 0) {
      await tx.metadataValue.createMany({
        data: metaRows.map((m) => ({
          documentId,
          definitionId: m.definitionId,
          valueText: m.valueText,
          valueDate: m.valueDate,
          valueNumber: m.valueNumber,
        })),
      });
    }

    if (input.fileObjectId) {
      await linkFirstVersion(tx, documentId, input.fileObjectId, input.actorId);
    }

    await appendAudit(tx, {
      actorType: "USER",
      actorId: input.actorId,
      eventType: "DOCUMENT_CREATED",
      targetType: "DOCUMENT",
      targetId: documentId,
      targetVersion: 1,
      outcome: "SUCCESS",
      correlationId: input.correlationId,
      afterSummary: { number, typeCode: type.code, confidentiality, hasFile: !!input.fileObjectId },
    });
    const doc = await tx.document.findUniqueOrThrow({ where: { id: documentId }, select: { ingestStatus: true } });
    return { documentId, number, ingestStatus: doc.ingestStatus };
  }
}

export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

async function linkFirstVersion(tx: Tx, documentId: string, fileObjectId: string, actorId: string): Promise<void> {
  const file = await tx.documentFileObject.findUnique({ where: { id: fileObjectId } });
  if (!file) throw new DomainError("NOT_FOUND");
  const versionId = uuidv7();
  await tx.documentVersion.create({
    data: {
      id: versionId,
      documentId,
      versionNumber: 1,
      fileObjectId,
      sha256: file.sha256,
      isReadOnly: false,
      isSigned: false,
      changeReason: "İlk sürüm",
      createdBy: actorId,
    },
  });
  await tx.document.update({ where: { id: documentId }, data: { currentVersionId: versionId } });
  if (file.scanStatus === "CLEAN") await onScanVerdict(tx, fileObjectId, "CLEAN");
  if (file.scanStatus === "INFECTED") await onScanVerdict(tx, fileObjectId, "INFECTED");
}

export interface NewVersionInput {
  readonly actorId: string;
  readonly correlationId: string;
  readonly documentId: string;
  readonly expectedRowVersion: number;
  readonly fileObjectId: string;
  readonly reason: string;
}

export async function createNewVersion(prisma: PrismaClient, input: NewVersionInput): Promise<{ versionNumber: number; rowVersion: number }> {
  return prisma.$transaction(async (tx) => {
    const doc = await tx.document.findUnique({ where: { id: input.documentId } });
    if (!doc) throw new DomainError("NOT_FOUND");
    const rv = checkRowVersion(doc.rowVersion, input.expectedRowVersion);
    if (!rv.ok) throw new DomainError("VERSION_CONFLICT", "Kayıt başka biri tarafından değiştirildi");
    // Koşullu talep: eşzamanlı iki yazımdan yalnız biri satır sürümünü ilerletir; diğeri VERSION_CONFLICT alır (kayıp güncelleme yok).
    const claimed = await tx.document.updateMany({
      where: { id: input.documentId, rowVersion: input.expectedRowVersion },
      data: { rowVersion: { increment: 1 } },
    });
    if (claimed.count !== 1) throw new DomainError("VERSION_CONFLICT", "Kayıt başka biri tarafından değiştirildi");
    if (input.reason.trim().length === 0) throw new DomainError("REASON_REQUIRED", "Yeni sürüm için gerekçe zorunludur");

    const prevRow = doc.currentVersionId
      ? await tx.documentVersion.findUnique({ where: { id: doc.currentVersionId } })
      : null;
    if (!prevRow) throw new DomainError("NOT_FOUND", "Geçerli sürüm yok");
    // R-LC-05: imzalı sürüm değişmez. Aktif/imzalı sözleşmede doğrudan yeni sürüm yazılamaz; zeyilname gerekir.
    if (prevRow.isSigned || prevRow.isReadOnly || doc.contractStatus === "ACTIVE") {
      throw new DomainError("VERSION_LOCKED", "İmzalı veya aktif sözleşmenin sürümü değiştirilemez; zeyilname oluşturun");
    }
    const file = await tx.documentFileObject.findUnique({ where: { id: input.fileObjectId } });
    if (!file) throw new DomainError("NOT_FOUND");

    const prev: VersionRecord = {
      id: prevRow.id,
      documentId: prevRow.documentId,
      versionNumber: prevRow.versionNumber,
      sha256: prevRow.sha256,
      fileObjectId: prevRow.fileObjectId,
      isSigned: prevRow.isSigned,
      isReadOnly: prevRow.isReadOnly,
      previousVersionId: null,
    };
    // Çekirdek kuralı: imzalı sürümden doğrudan yazılamaz; sürüm numarası artar, önceki kilitlenir.
    const { next, lockedPrevious } = coreNewVersion(prev, {
      id: uuidv7(),
      sha256: file.sha256,
      fileObjectId: input.fileObjectId,
      reason: input.reason,
    });

    await tx.documentVersion.update({
      where: { id: prevRow.id },
      data: { isReadOnly: lockedPrevious.isReadOnly, supersededAt: new Date() },
    });
    await tx.documentVersion.create({
      data: {
        id: next.id,
        documentId: input.documentId,
        versionNumber: next.versionNumber,
        fileObjectId: input.fileObjectId,
        sha256: file.sha256,
        isReadOnly: false,
        isSigned: false,
        changeReason: input.reason.trim(),
        createdBy: input.actorId,
      },
    });
    // Yeni sürüm yeniden taranır: belge karantinaya döner (READY'den geri çekilir).
    await tx.document.update({
      where: { id: input.documentId },
      data: {
        currentVersionId: next.id,
        ingestStatus: "QUARANTINED",
        rowVersion: doc.rowVersion + 1,
        updatedBy: input.actorId,
      },
    });
    if (file.scanStatus === "CLEAN") await onScanVerdict(tx, input.fileObjectId, "CLEAN");
    if (file.scanStatus === "INFECTED") await onScanVerdict(tx, input.fileObjectId, "INFECTED");

    await appendAudit(tx, {
      actorType: "USER",
      actorId: input.actorId,
      eventType: "DOCUMENT_VERSION_CREATED",
      targetType: "DOCUMENT",
      targetId: input.documentId,
      targetVersion: next.versionNumber,
      outcome: "SUCCESS",
      reason: input.reason.trim(),
      correlationId: input.correlationId,
      beforeSummary: { versionNumber: prevRow.versionNumber, sha256: prevRow.sha256 },
      afterSummary: { versionNumber: next.versionNumber, sha256: file.sha256 },
    });
    return { versionNumber: next.versionNumber, rowVersion: doc.rowVersion + 1 };
  });
}
