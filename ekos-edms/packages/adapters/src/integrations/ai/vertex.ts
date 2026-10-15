// Vertex AI (Google Cloud). Erişim belirteci ortamdan okunur (kısa ömürlü; üretimde workload identity ile yenilenir).
import type { AiProvider, AiResult } from "./types.js";
import { buildGenerateBody, postGenerate } from "./http.js";

export class VertexProvider implements AiProvider {
  readonly key = "vertex" as const;
  constructor(
    readonly model: string,
    private readonly project: string,
    private readonly location: string,
    private readonly accessToken: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}
  generateJson(input: { system: string; user: string; timeoutMs?: number }): Promise<AiResult> {
    const host = `${this.location}-aiplatform.googleapis.com`;
    const url = `https://${host}/v1/projects/${encodeURIComponent(this.project)}/locations/${encodeURIComponent(this.location)}/publishers/google/models/${encodeURIComponent(this.model)}:generateContent`;
    return postGenerate(url, { Authorization: `Bearer ${this.accessToken}` }, buildGenerateBody(input.system, input.user), input.timeoutMs ?? 30_000, this.fetchFn);
  }
}
