// Sürümleme (Faz 2, madde 3). Yeni içerik = yeni DocumentVersion; önceki sürüm korunur.
// Salt-okunur (isReadOnly) sürüm hiçbir alanı değiştirilemez ve silinemez.
export interface VersionRecord {
  readonly id: string;
  readonly documentId: string;
  readonly versionNumber: number;
  readonly sha256: string;
  readonly fileObjectId: string | null;
  readonly isSigned: boolean;
  readonly isReadOnly: boolean;
  readonly previousVersionId: string | null;
}

/** Trigger ile (0002_db_guards) korunan alanlar. Bu listedeki bir alan değişirse kayıt reddedilir. */
export const IMMUTABLE_VERSION_FIELDS = [
  "sha256",
  "fileObjectId",
  "isSigned",
  "isReadOnly",
  "versionNumber",
  "documentId",
] as const;

export type VersionMutationError =
  | { readonly code: "VERSION_READ_ONLY" }
  | { readonly code: "IMMUTABLE_FIELD"; readonly field: string };

/** Güncelleme önerisi için değişen alanları kontrol eder. */
export function checkVersionPatch(
  current: VersionRecord,
  patch: Partial<Pick<VersionRecord, "sha256" | "fileObjectId" | "isSigned" | "isReadOnly" | "versionNumber" | "documentId">>,
): VersionMutationError | null {
  for (const field of IMMUTABLE_VERSION_FIELDS) {
    const next = patch[field];
    if (next !== undefined && next !== current[field]) {
      return current.isReadOnly ? { code: "VERSION_READ_ONLY" } : { code: "IMMUTABLE_FIELD", field };
    }
  }
  if (current.isReadOnly) return { code: "VERSION_READ_ONLY" };
  return null;
}

/** Sürüm hiçbir zaman fiziksel olarak silinmez (soft-delete ve saklama kuralı). */
export const VERSION_PHYSICAL_DELETE_ALLOWED = false as const;

export interface NewVersionInput {
  readonly id: string;
  readonly sha256: string;
  readonly fileObjectId: string;
  readonly reason: string;
  readonly isSigned?: boolean;
}

/** Yeni sürüm üretir; önceki sürüm salt-okunur kilitlenir ve gerekçe zorunludur. */
export function createNewVersion(
  previous: VersionRecord,
  input: NewVersionInput,
): { readonly next: VersionRecord; readonly lockedPrevious: VersionRecord } {
  if (previous.isSigned) {
    throw new Error("İmzalı sürüm yerine doğrudan yazılamaz; yeni sürüm gerekir (bu fonksiyon zaten yeni sürüm üretir)");
  }
  if (input.reason.trim().length === 0) throw new Error("Yeni sürüm için gerekçe zorunludur");
  const next: VersionRecord = {
    id: input.id,
    documentId: previous.documentId,
    versionNumber: previous.versionNumber + 1,
    sha256: input.sha256,
    fileObjectId: input.fileObjectId,
    isSigned: input.isSigned ?? false,
    isReadOnly: false,
    previousVersionId: previous.id,
  };
  return { next, lockedPrevious: { ...previous, isReadOnly: true } };
}

/** Sürüm karşılaştırma meta görünümü: içerik farkı değil, alan bazlı meta farkı. */
export function compareVersionMetadata(
  a: VersionRecord,
  b: VersionRecord,
): { readonly field: string; readonly from: unknown; readonly to: unknown }[] {
  const fields = ["versionNumber", "sha256", "isSigned", "isReadOnly", "fileObjectId"] as const;
  return fields
    .filter((f) => a[f] !== b[f])
    .map((f) => ({ field: f, from: a[f], to: b[f] }));
}
