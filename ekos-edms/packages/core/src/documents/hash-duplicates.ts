// Kopya tespiti (Faz 2, madde 8). SHA-256 birebir eşleşme UYARIDIR; metadata benzerliği yalnızca uyarıdır.
// Bu modül hiçbir yüklemeyi engellemez.
import { createHash } from "node:crypto";
import { normalizeForSearch } from "../search/normalize-tr.js";

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface DuplicateCandidate {
  readonly documentId: string;
  readonly sha256: string;
  readonly title: string;
  readonly documentTypeId: string;
  readonly counterpartyId: string | null;
  readonly documentDate: string | null; // YYYY-MM-DD
}

export interface DuplicateInput {
  readonly sha256: string;
  readonly title: string;
  readonly documentTypeId: string;
  readonly counterpartyId: string | null;
  readonly documentDate: string | null;
}

export interface DuplicateReport {
  /** Birebir içerik kopyası (SHA-256 eşleşmesi). */
  readonly exactDuplicateIds: readonly string[];
  /** Metadata benzerliği — yalnızca uyarı, kesin kopya DEĞİL. */
  readonly similarMetadataIds: readonly string[];
  /** Hiçbir durumda yüklemeyi engellemez. */
  readonly blocking: false;
}

/**
 * Belirli bir kullanıcıya görünür adaylar üzerinde çalışır. Çağıran taraf adayları
 * yetki filtresinden geçirmiş olmalıdır; görünmeyen belgenin varlığı rapora sızmaz.
 */
export function detectDuplicates(input: DuplicateInput, visible: readonly DuplicateCandidate[]): DuplicateReport {
  const exact: string[] = [];
  const similar: string[] = [];
  const normTitle = normalizeForSearch(input.title);
  for (const c of visible) {
    if (c.sha256 === input.sha256) {
      exact.push(c.documentId);
      continue;
    }
    const sameType = c.documentTypeId === input.documentTypeId;
    const sameCounterparty = c.counterpartyId !== null && c.counterpartyId === input.counterpartyId;
    const sameDate = c.documentDate !== null && c.documentDate === input.documentDate;
    const sameTitle = normalizeForSearch(c.title) === normTitle;
    if (sameType && sameCounterparty && sameDate && sameTitle) similar.push(c.documentId);
  }
  return { exactDuplicateIds: exact, similarMetadataIds: similar, blocking: false };
}
