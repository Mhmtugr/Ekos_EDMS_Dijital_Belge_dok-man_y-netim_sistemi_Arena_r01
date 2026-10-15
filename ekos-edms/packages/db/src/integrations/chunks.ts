// RAG indeksi: OCR sayfa metninden parçalar üretir (Faz 6, madde 4). Yalnızca OCR tamamlandığında çağrılır.
import type { Prisma } from "@prisma/client";
import { chunkPageText, normalizeForSearch } from "@ekos/core";

export interface OcrPageText {
  readonly page: number;
  readonly text: string;
}

/** Belge+dosya için mevcut parçaları siler ve yeniden yazar (yeniden deneme güvenli). */
export async function indexOcrChunks(
  tx: Prisma.TransactionClient,
  input: { readonly documentId: string; readonly fileObjectId: string; readonly pages: readonly OcrPageText[] },
): Promise<number> {
  await tx.documentTextChunk.deleteMany({ where: { documentId: input.documentId, fileObjectId: input.fileObjectId } });
  const rows: Prisma.DocumentTextChunkCreateManyInput[] = [];
  for (const p of input.pages) {
    chunkPageText(p.text).forEach((text, ordinal) => {
      rows.push({
        documentId: input.documentId,
        fileObjectId: input.fileObjectId,
        page: p.page,
        ordinal,
        text,
        normText: normalizeForSearch(text),
      });
    });
  }
  if (rows.length > 0) await tx.documentTextChunk.createMany({ data: rows });
  return rows.length;
}
