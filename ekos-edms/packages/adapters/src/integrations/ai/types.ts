// AI sağlayıcı portu (AiProvider). AI'ya araç/yazma erişimi YOKTUR: yalnızca metin → JSON üretimi.
export type AiResult = { readonly ok: true; readonly json: unknown } | { readonly ok: false; readonly code: string };

export interface AiProvider {
  readonly key: "gemini" | "vertex";
  readonly model: string;
  generateJson(input: { readonly system: string; readonly user: string; readonly timeoutMs?: number }): Promise<AiResult>;
}

export type AiProviderState = { readonly status: "NOT_CONFIGURED" } | { readonly status: "CONFIGURED"; readonly provider: AiProvider };
