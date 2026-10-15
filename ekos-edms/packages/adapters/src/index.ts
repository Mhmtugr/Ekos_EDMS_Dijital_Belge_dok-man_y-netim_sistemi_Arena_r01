// @ekos/adapters — dış sistem uygulamaları (depolama, antivirüs, OCR). Portlar @ekos/core/src/ports.ts'tedir.
// Yapılandırılmamış adaptör asla "Bağlı" gösterilmez (A5/4).
export * from "./storage/fs-storage.js";
export * from "./antivirus/clamd.js";
export * from "./ocr/tesseract.js";
export * from "./notify/index.js";

/** Entegrasyon durumu — A4/Faz 6 ile birebir. */
export type IntegrationStatus = "NOT_CONFIGURED" | "CONFIGURED_UNVERIFIED" | "CONNECTED" | "FAILED";
export * from "./integrations/index.js";
