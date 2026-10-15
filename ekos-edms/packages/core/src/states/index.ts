// Durum tipleri — ARCHITECTURE.md §6 ve A6 ile birebir.
// Geçiş tabloları ve geçiş fonksiyonları Faz 3'te (sözleşme) ve Faz 2'de (belge) yazılacak.
// Bu dosya yalnızca tip birliklerini (union) tanımlar; mantık içermez.

/** Eksen 1 — belge işleme durumu. READY olmayan belge yayımlanamaz. */
export const INGEST_STATUSES = [
  "QUARANTINED",
  "PROCESSING",
  "METADATA_PENDING",
  "READY",
  "REJECTED",
  "FAILED_RETRYABLE",
] as const;
export type IngestStatus = (typeof INGEST_STATUSES)[number];

/** Eksen 2 — genel belge profili. */
export const GENERAL_LIFECYCLE_STATUSES = [
  "DRAFT",
  "IN_REVIEW",
  "PENDING_APPROVAL",
  "APPROVED",
  "ACTIVE",
  "SUPERSEDED",
  "ARCHIVED",
  "DISPOSAL_REVIEW",
  "DISPOSED",
] as const;
export type GeneralLifecycleStatus = (typeof GENERAL_LIFECYCLE_STATUSES)[number];

/** Eksen 2 — sözleşme profili. INVALID her durumdan yalnızca yetkili ve gerekçeli. */
export const CONTRACT_LIFECYCLE_STATUSES = [
  "DRAFT",
  "IN_REVIEW",
  "PENDING_APPROVAL",
  "READY_FOR_SIGNATURE",
  "PENDING_SIGNATURE",
  "ACTIVE",
  "AMENDMENT_PENDING",
  "RENEWAL_REVIEW",
  "EXPIRED",
  "TERMINATED",
  "CANCELLED",
  "ARCHIVED",
  "DISPOSAL_REVIEW",
  "DISPOSED",
  "INVALID",
] as const;
export type ContractLifecycleStatus = (typeof CONTRACT_LIFECYCLE_STATUSES)[number];

/** Hukuki bekletme bir durum değil, bayraktır (A6). Bu tip yalnızca bayrağın varlığını belirtir. */
export interface LegalHoldFlag {
  readonly legalHoldActive: boolean;
}

/** Gizlilik seviyeleri — sıralı (A4). Karşılaştırma için sıra dizisi kullanılır. */
export const CONFIDENTIALITY_LEVELS = [
  "INTERNAL",
  "CONFIDENTIAL",
  "RESTRICTED",
  "HIGHLY_RESTRICTED",
] as const;

export type ConfidentialityLevel = (typeof CONFIDENTIALITY_LEVELS)[number];

/** Yaşam döngüsü profili seçimi. */
export type LifecycleProfile = "GENERAL" | "CONTRACT";
