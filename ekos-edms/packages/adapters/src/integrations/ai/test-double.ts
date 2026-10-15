// MOCK ENTEGRASYON (yalnız test): gerçek sağlayıcı çağrısı yapmaz; verilen yanıtı döndürür ve çağrıları kaydeder.
// Testlerde "mock entegrasyonla test" olarak etiketlenir.
import type { AiProvider, AiResult } from "./types.js";

export class MockAiProvider implements AiProvider {
  readonly key = "gemini" as const;
  readonly model = "mock-model";
  readonly calls: { system: string; user: string }[] = [];
  constructor(private readonly respond: (user: string) => AiResult) {}
  generateJson(input: { system: string; user: string }): Promise<AiResult> {
    this.calls.push({ system: input.system, user: input.user });
    return Promise.resolve(this.respond(input.user));
  }
}
