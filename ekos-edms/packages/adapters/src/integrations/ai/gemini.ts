// Gemini API (Google AI Studio anahtarı). Anahtar başlıkta gönderilir; URL'de yer almaz (günlük sızıntısı önlenir).
import type { AiProvider, AiResult } from "./types.js";
import { buildGenerateBody, postGenerate } from "./http.js";

export class GeminiProvider implements AiProvider {
  readonly key = "gemini" as const;
  constructor(
    readonly model: string,
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}
  generateJson(input: { system: string; user: string; timeoutMs?: number }): Promise<AiResult> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    return postGenerate(url, { "x-goog-api-key": this.apiKey }, buildGenerateBody(input.system, input.user), input.timeoutMs ?? 30_000, this.fetchFn);
  }
}
