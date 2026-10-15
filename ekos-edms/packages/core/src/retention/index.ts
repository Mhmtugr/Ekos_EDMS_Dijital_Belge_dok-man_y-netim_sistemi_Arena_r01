// Saklama tipleri — Faz 4'te doldurulacak. Evrensel varsayılan süre KODLANMAZ (A5/2).

/** Başlangıç olayları (Faz 4, madde 1). */
export const RETENTION_START_EVENTS = [
  "DOCUMENT_CREATED",
  "CONTRACT_END",
  "FISCAL_YEAR_END",
  "MANUAL_EVENT",
] as const;

export type RetentionStartEvent = (typeof RETENTION_START_EVENTS)[number];

/** İmha yöntemi. Fiziksel imha ayrı bir kanıt kaydıdır. */
export const DISPOSAL_METHODS = ["DIGITAL_DELETE", "PHYSICAL_DESTRUCTION_RECORD"] as const;

export type DisposalMethod = (typeof DISPOSAL_METHODS)[number];
