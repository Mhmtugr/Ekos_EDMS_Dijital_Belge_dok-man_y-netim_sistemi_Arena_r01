// Toplu içe aktarım (Faz 2, madde 9). CSV manifest: satır bazlı işlem, her satırın sonucu kalıcı,
// hatalı satır sessizce atlanmaz, yarıda kalan batch yalnızca kalan satırlardan devam eder.
import { createHash } from "node:crypto";
import { parseCsv, validateManifest, uuidv7, type AntivirusPort, type ManifestRow, type ObjectStoragePort } from "@ekos/core";
import type { PrismaClient } from "@prisma/client";
import { appendAudit } from "../audit.js";
import { sha256OfBytes, scanFile } from "./upload.js";
import { createDocumentInTx, type Tx } from "./create.js";
import { DomainError, requireActiveType } from "./shared.js";

export interface ManifestDeps {
  readonly prisma: PrismaClient;
  readonly storage: ObjectStoragePort;
  readonly av: AntivirusPort;
}

export const MANIFEST_MAX_BYTES = 5 * 1024 * 1024;

/** Manifest yükleme: yalnızca düz UTF-8 CSV kabul edilir; tarama CLEAN olmadan içe aktarma başlamaz. */
export async function registerManifest(
  deps: ManifestDeps,
  input: { actorId: string; correlationId: string; filename: string; bytes: Uint8Array },
): Promise<{ fileObjectId: string; scanStatus: string }> {
  // Manifest CSV'dir: uzantı .csv, boyut sınırı içinde, NUL baytı yok, geçerli UTF-8. Dosya türü kataloğu (PDF/görüntü/ofis) burada uygulanmaz.
  if (!/\.csv$/i.test(input.filename)) throw new DomainError("FILE_REJECTED", "Manifest .csv olmalıdır");
  if (input.bytes.length === 0 || input.bytes.length > MANIFEST_MAX_BYTES) throw new DomainError("FILE_REJECTED", "Manifest boyutu geçersiz");
  if (input.bytes.includes(0)) throw new DomainError("FILE_REJECTED", "Manifest ikili içerik taşıyor");
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
  } catch {
    throw new DomainError("FILE_REJECTED", "Manifest geçerli UTF-8 değil");
  }
  const storageKey = `quarantine/${uuidv7()}`;
  await deps.storage.put(storageKey, input.bytes);
  const fileObjectId = uuidv7();
  await deps.prisma.$transaction(async (tx) => {
    await tx.documentFileObject.create({
      data: {
        id: fileObjectId,
        storageKey,
        storagePrefix: "quarantine",
        originalFileName: input.filename,
        mimeType: "text/csv",
        byteSize: BigInt(input.bytes.length),
        sha256: sha256OfBytes(input.bytes),
        scanStatus: "PENDING",
        createdBy: input.actorId,
      },
    });
    await appendAudit(tx, { actorType: "USER", actorId: input.actorId, eventType: "MANIFEST_RECEIVED", targetType: "DocumentFileObject", targetId: fileObjectId, outcome: "SUCCESS", correlationId: input.correlationId });
  });
  const scan = await scanFile({ ...deps }, { fileObjectId, actorId: input.actorId, correlationId: input.correlationId });
  return { fileObjectId, scanStatus: scan.status };
}

export interface RowError {
  /** Veri satırı indeksi (1..totalRows); ImportRowResult.rowNumber ile aynıdır. */
  readonly rowNumber: number;
  /** Dosyadaki fiziksel satır (başlık = 1). Kullanıcıya raporlanır. */
  readonly line: number;
  readonly code: string;
  readonly message: string;
}

export interface ImportReport {
  readonly batchId: string;
  readonly status: string;
  readonly totalRows: number;
  readonly okRows: number;
  readonly errorRows: number;
  readonly errors: readonly RowError[];
}

/** Yeni toplu içe aktarma başlatır. Başlık/format hatası batch'i FAILED yapar (satıra bağlanamayan hata). */
export async function startManifestImport(deps: ManifestDeps, input: { actorId: string; correlationId: string; fileObjectId: string }): Promise<ImportReport> {
  const file = await deps.prisma.documentFileObject.findUnique({ where: { id: input.fileObjectId } });
  if (!file) throw new DomainError("NOT_FOUND");
  if (file.scanStatus !== "CLEAN") throw new DomainError("FILE_NOT_CLEAN", "Manifest taramadan geçmeden içe aktarılamaz");
  const bytes = await deps.storage.get(file.storageKey);
  if (sha256OfBytes(bytes) !== file.sha256) throw new DomainError("INTEGRITY_MISMATCH");

  const csv = parseCsv(new TextDecoder("utf-8").decode(bytes));
  const validation = validateManifest(csv);
  const headerErrors = validation.errors.filter((e) => e.code === "MISSING_COLUMN");
  const batchId = uuidv7();
  const total = csv.rows.length;

  if (headerErrors.length > 0 || csv.parseErrors.length > 0 || csv.rows.length === 0) {
    const message = headerErrors.map((e) => e.message).concat(csv.parseErrors.map((e) => e.message)).join("; ") || "Manifest boş";
    await deps.prisma.$transaction(async (tx) => {
      await tx.importBatch.create({ data: { id: batchId, kind: "DOCUMENT_MANIFEST", status: "FAILED", fileObjectId: file.id, totalRows: 0, startedById: input.actorId, finishedAt: new Date() } });
      await appendAudit(tx, { actorType: "USER", actorId: input.actorId, eventType: "IMPORT_FAILED", targetType: "ImportBatch", targetId: batchId, outcome: "FAILED", reason: message, correlationId: input.correlationId });
    });
    return { batchId, status: "FAILED", totalRows: 0, okRows: 0, errorRows: 0, errors: [{ rowNumber: 0, line: 1, code: "MANIFEST_INVALID", message }] };
  }

  // Tekrarlı dosya adı ve satır hataları satır bazında raporlanır; geçerli satırlar işlenir.
  await deps.prisma.importBatch.create({ data: { id: batchId, kind: "DOCUMENT_MANIFEST", status: "RUNNING", fileObjectId: file.id, totalRows: total, startedById: input.actorId } });
  await deps.prisma.$transaction((tx) => appendAudit(tx, { actorType: "USER", actorId: input.actorId, eventType: "IMPORT_STARTED", targetType: "ImportBatch", targetId: batchId, outcome: "SUCCESS", correlationId: input.correlationId, afterSummary: { totalRows: total } }));
  return processRows(deps, { batchId, actorId: input.actorId, correlationId: input.correlationId, bytes, rows: csv.rows, validationErrors: validation.errors, valid: validation.valid, lastRowNumber: 0 });
}

/** Yarıda kalan batch'i devam ettirir: yalnızca son işlenen satırdan sonrası planlanır. Tamamlanmışsa değişiklik yapmaz. */
export async function resumeManifestImport(deps: ManifestDeps, input: { actorId: string; correlationId: string; batchId: string }): Promise<ImportReport> {
  const batch = await deps.prisma.importBatch.findUnique({ where: { id: input.batchId }, include: { fileObject: true } });
  if (!batch) throw new DomainError("NOT_FOUND");
  if (batch.status !== "RUNNING") return toReport(batch, []);
  const bytes = await deps.storage.get(batch.fileObject.storageKey);
  if (sha256OfBytes(bytes) !== batch.fileObject.sha256) throw new DomainError("INTEGRITY_MISMATCH");
  const csv = parseCsv(new TextDecoder("utf-8").decode(bytes));
  const validation = validateManifest(csv);
  return processRows(deps, { batchId: batch.id, actorId: input.actorId, correlationId: input.correlationId, bytes, rows: csv.rows, validationErrors: validation.errors, valid: validation.valid, lastRowNumber: batch.lastRowNumber });
}

interface ProcessInput {
  readonly batchId: string;
  readonly actorId: string;
  readonly correlationId: string;
  readonly bytes: Uint8Array;
  readonly rows: readonly { line: number; cells: readonly string[] }[];
  readonly validationErrors: readonly { line: number; code: string; message: string }[];
  readonly valid: readonly ManifestRow[];
  readonly lastRowNumber: number;
}


async function processRows(deps: ManifestDeps, input: ProcessInput): Promise<ImportReport> {
  const errorsByLine = new Map<number, { code: string; message: string }>();
  for (const e of input.validationErrors) if (!errorsByLine.has(e.line)) errorsByLine.set(e.line, { code: e.code, message: e.message });
  // rowNumber = veri satırı indeksi (1-based); şemadaki lastRowNumber <= totalRows kuralı bunu gerektirir.
  const valid = input.valid;
  const validByLine = new Map<number, ManifestRow>(valid.map((r) => [r.line, r]));
  const fileNameCounts = new Map<string, number>();
  for (const r of valid) fileNameCounts.set(r.fileName, (fileNameCounts.get(r.fileName) ?? 0) + 1);

  const errors: RowError[] = [];
  for (const [i, row] of input.rows.entries()) {
    const rowNumber = i + 1;
    if (rowNumber <= input.lastRowNumber) continue; // yeniden başlatmada işlenmiş satır
    const rawHash = createHash("sha256").update(row.cells.join("\u001f")).digest("hex");
    const structural = errorsByLine.get(row.line);
    const manifestRow = validByLine.get(row.line);
    let outcome: { status: "OK"; createdEntityId: string } | { status: "ERROR"; code: string; message: string };

    if (!manifestRow || structural) {
      outcome = { status: "ERROR", code: structural?.code ?? "ROW_INVALID", message: structural?.message ?? "Satır doğrulanamadı" };
    } else if ((fileNameCounts.get(manifestRow.fileName) ?? 0) > 1) {
      outcome = { status: "ERROR", code: "DUPLICATE_FILE_NAME_IN_MANIFEST", message: "Aynı dosya adı manifestte birden fazla" };
    } else {
      outcome = await tryRow(deps, input, manifestRow);
    }
    await recordRow(deps.prisma, input, rowNumber, rawHash, outcome);
    if (outcome.status === "ERROR") errors.push({ rowNumber, line: row.line, code: outcome.code, message: outcome.message });
  }

  // Satır sonuçları ve sayaçlar: sonuç kaydı yoksa batch tamamlanmaz.
  const batch = await deps.prisma.importBatch.findUniqueOrThrow({ where: { id: input.batchId }, include: { fileObject: true } });
  const done = batch.okRows + batch.errorRows >= batch.totalRows;
  if (done) {
    const status = batch.errorRows === 0 ? "COMPLETED" : "COMPLETED_WITH_ERRORS";
    await deps.prisma.$transaction(async (tx) => {
      await tx.importBatch.update({ where: { id: batch.id }, data: { status, finishedAt: new Date() } });
      await appendAudit(tx, { actorType: "USER", actorId: input.actorId, eventType: "IMPORT_FINISHED", targetType: "ImportBatch", targetId: batch.id, outcome: "SUCCESS", correlationId: input.correlationId, afterSummary: { okRows: batch.okRows, errorRows: batch.errorRows, status } });
    });
  }
  const finalBatch = await deps.prisma.importBatch.findUniqueOrThrow({ where: { id: input.batchId } });
  return toReport(finalBatch, errors);
}

async function tryRow(deps: ManifestDeps, input: ProcessInput, row: ManifestRow): Promise<{ status: "OK"; createdEntityId: string } | { status: "ERROR"; code: string; message: string }> {
  try {
    return await deps.prisma.$transaction(async (tx) => {
      const type = await requireActiveType(tx, row.documentTypeCode);
      const file = await findUnlinkedFile(tx, row.fileName);
      const created = await createDocumentInTx(tx, {
        actorId: input.actorId,
        correlationId: input.correlationId,
        typeCode: type.code,
        title: row.title,
        metadata: { documentDate: row.documentDate },
        fileObjectId: file.id,
      });
      return { status: "OK" as const, createdEntityId: created.documentId };
    });
  } catch (err) {
    if (err instanceof DomainError) return { status: "ERROR", code: err.code, message: err.message.slice(0, 480) };
    throw err;
  }
}

async function findUnlinkedFile(tx: Tx, fileName: string) {
  const candidates = await tx.documentFileObject.findMany({ where: { originalFileName: fileName, version: null }, take: 2 });
  if (candidates.length === 0) throw new DomainError("FILE_NOT_FOUND", `Dosya bulunamadı: ${fileName}`);
  const [only] = candidates;
  if (candidates.length > 1 || !only) throw new DomainError("FILE_AMBIGUOUS", `Birden fazla eşleşen dosya: ${fileName}`);
  return only;
}

async function recordRow(prisma: PrismaClient, input: ProcessInput, rowNumber: number, rawRowHash: string, outcome: { status: "OK"; createdEntityId: string } | { status: "ERROR"; code: string; message: string }): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.importRowResult.create({
      data: {
        batchId: input.batchId,
        rowNumber,
        status: outcome.status,
        errorCode: outcome.status === "ERROR" ? outcome.code : null,
        errorMessage: outcome.status === "ERROR" ? outcome.message : null,
        rawRowHash,
        createdEntityId: outcome.status === "OK" ? outcome.createdEntityId : null,
      },
    });
    await tx.importBatch.update({
      where: { id: input.batchId },
      data: {
        lastRowNumber: rowNumber,
        okRows: { increment: outcome.status === "OK" ? 1 : 0 },
        errorRows: { increment: outcome.status === "ERROR" ? 1 : 0 },
      },
    });
  });
}

function toReport(batch: { id: string; status: string; totalRows: number; okRows: number; errorRows: number }, errors: RowError[]): ImportReport {
  return { batchId: batch.id, status: batch.status, totalRows: batch.totalRows, okRows: batch.okRows, errorRows: batch.errorRows, errors };
}

