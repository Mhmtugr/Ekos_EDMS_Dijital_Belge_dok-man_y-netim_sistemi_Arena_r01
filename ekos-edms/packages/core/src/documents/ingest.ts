// Yükleme/işleme durum makinesi (Faz 2, madde 2 ve 4). Eksen 1 = INGEST_STATUSES.
// Kurallar: tarama yapılmadan veya tarama servisi kapalıyken belge READY olamaz;
// OCR başarısızlığında içerik uydurulmaz, iş FAILED_RETRYABLE kalır.
import type { IngestStatus } from "../states/index.js";

export type IngestEvent =
  | "SCAN_CLEAN"
  | "SCAN_INFECTED"
  | "SCAN_UNAVAILABLE"
  | "OCR_NOT_REQUIRED"
  | "OCR_STARTED"
  | "OCR_SUCCEEDED"
  | "OCR_FAILED_TRANSIENT"
  /** Kalıcı OCR hatası (ör. desteklenmeyen tür): belge yayımlanamaz kalır, yeniden deneme YOKTUR. */
  | "OCR_FAILED_FINAL"
  | "METADATA_COMPLETED"
  | "METADATA_INCOMPLETE"
  | "RETRY_REQUESTED";

export const MAX_OCR_ATTEMPTS = 3;

export class IllegalIngestTransition extends Error {
  constructor(
    readonly from: IngestStatus,
    readonly event: IngestEvent,
  ) {
    super(`Geçersiz yükleme geçişi: ${from} + ${event}`);
    this.name = "IllegalIngestTransition";
  }
}

export interface IngestState {
  readonly status: IngestStatus;
  readonly ocrAttempts: number;
}

export const INITIAL_INGEST: IngestState = { status: "QUARANTINED", ocrAttempts: 0 };

/** Yalnızca bu durumdaki belge yayımlanabilir/aranabilir olarak işaretlenebilir. */
export function isPublishable(state: IngestState): boolean {
  return state.status === "READY";
}

export function transitionIngest(state: IngestState, event: IngestEvent): IngestState {
  const { status } = state;
  const illegal = (): never => {
    throw new IllegalIngestTransition(status, event);
  };

  switch (status) {
    case "QUARANTINED":
      if (event === "SCAN_CLEAN") return { status: "PROCESSING", ocrAttempts: 0 };
      if (event === "SCAN_INFECTED") return { status: "REJECTED", ocrAttempts: state.ocrAttempts };
      // Tarama servisi kapalı: karantinada kalır; READY'ye asla geçmez.
      if (event === "SCAN_UNAVAILABLE") return state;
      return illegal();

    case "PROCESSING":
      // Tür OCR gerektirmiyorsa metin adımı atlanır; belge doğrudan metadata aşamasına geçer.
      if (event === "OCR_NOT_REQUIRED") return { status: "METADATA_PENDING", ocrAttempts: state.ocrAttempts };
      if (event === "OCR_STARTED") return { status, ocrAttempts: state.ocrAttempts + 1 };
      if (event === "OCR_SUCCEEDED") return { status: "METADATA_PENDING", ocrAttempts: state.ocrAttempts };
      if (event === "OCR_FAILED_TRANSIENT") return { status: "FAILED_RETRYABLE", ocrAttempts: state.ocrAttempts };
      if (event === "OCR_FAILED_FINAL") return { status: "FAILED_RETRYABLE", ocrAttempts: MAX_OCR_ATTEMPTS };
      return illegal();

    case "METADATA_PENDING":
      if (event === "METADATA_COMPLETED") return { status: "READY", ocrAttempts: state.ocrAttempts };
      if (event === "METADATA_INCOMPLETE") return state;
      return illegal();

    case "FAILED_RETRYABLE":
      if (event === "RETRY_REQUESTED") {
        // Deneme sınırı dolmuşsa FAILED_RETRYABLE kalır; sessizce READY olmaz.
        if (state.ocrAttempts >= MAX_OCR_ATTEMPTS) return state;
        return { status: "PROCESSING", ocrAttempts: state.ocrAttempts };
      }
      return illegal();

    case "READY":
    case "REJECTED":
      return illegal();
  }
}
