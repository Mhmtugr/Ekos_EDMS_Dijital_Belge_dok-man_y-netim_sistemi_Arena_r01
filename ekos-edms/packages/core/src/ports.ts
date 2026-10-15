// Dış sistem portları (tip sözleşmeleri). Uygulamaları packages/adapters'tadır; core I/O yapmaz.
// Kural: taramanın sonucu belirsizse (UNAVAILABLE/zaman aşımı) asla CLEAN üretilmez.

export interface ObjectStoragePort {
  /** Anahtar yalnızca `quarantine/` veya `objects/` önekiyle başlar; mevcut anahtarın üzerine yazılmaz. */
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
  /** Atomik taşıma (üzerine yazmaz). Hedef varsa hata verir. Hedef prefix kuralı servis katmanındadır. */
  move(fromKey: string, toKey: string): Promise<void>;
  /** İmha (Faz 4): nesne yoksa başarılı döner (idempotent). Yalnızca onaylı imha yürütmesi çağırır. */
  delete(key: string): Promise<void>;
}

export type ScanVerdict =
  | { readonly status: "CLEAN" }
  | { readonly status: "INFECTED"; readonly signature: string }
  | { readonly status: "UNAVAILABLE"; readonly reason: string };

export interface AntivirusPort {
  scan(bytes: Uint8Array): Promise<ScanVerdict>;
}

export interface OcrPageResult {
  readonly page: number;
  readonly text: string;
  /** 0–1 ortalama sözcük güveni. */
  readonly confidence: number;
}

export type OcrOutcome =
  | { readonly status: "OK"; readonly pages: readonly OcrPageResult[]; readonly languages: string }
  /** RETRYABLE: geçici hata (zaman aşımı, süreç çökmesi). FINAL: yeniden denemek anlamsız (desteklenmeyen tür, bozuk dosya). */
  | { readonly status: "FAILED"; readonly retryable: boolean; readonly code: string };

export interface OcrPort {
  recognize(input: { readonly bytes: Uint8Array; readonly mime: string; readonly languages: string }): Promise<OcrOutcome>;
}
