// AI sağlayıcı seçimi. Varsayılan: NOT_CONFIGURED. Açık yapılandırma (AI_PROVIDER + kimlik bilgisi) olmadan sağlayıcı yoktur.
import { readEnv, type Env } from "../types.js";
import type { AiProviderState } from "./types.js";
import { GeminiProvider } from "./gemini.js";
import { VertexProvider } from "./vertex.js";

export const AI_KEY = "ai";

/**
 * Dış AI'ya veri gönderme kapısı (R-AI-03, geçici tasarım A5/5): yalnız gerçek ortam değişkenleriyle açılır.
 * - AI_DATA_PROCESSING_APPROVED=true (veri işleme onayı verildi)
 * - AI_APPROVED_DOCUMENT_TYPES=KOD1,KOD2 (onaylı belge türleri; boşsa hiçbir belge AI'ya gitmez)
 */
export function readAiGate(env: Env): { readonly dataProcessingApproved: boolean; readonly approvedTypeCodes: readonly string[] } {
  const approvedTypeCodes = (readEnv(env, "AI_APPROVED_DOCUMENT_TYPES") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[A-Z0-9_]{2,40}$/.test(s));
  return { dataProcessingApproved: readEnv(env, "AI_DATA_PROCESSING_APPROVED") === "true", approvedTypeCodes };
}

export function createAiProvider(env: Env, fetchFn: typeof fetch = fetch): AiProviderState {
  const kind = readEnv(env, "AI_PROVIDER");
  const model = readEnv(env, "AI_MODEL");
  if (kind === null || model === null) return { status: "NOT_CONFIGURED" };
  if (!readAiGate(env).dataProcessingApproved) return { status: "NOT_CONFIGURED" };
  if (kind === "gemini") {
    const key = readEnv(env, "GEMINI_API_KEY");
    if (!key) return { status: "NOT_CONFIGURED" };
    return { status: "CONFIGURED", provider: new GeminiProvider(model, key, fetchFn) };
  }
  if (kind === "vertex") {
    const project = readEnv(env, "VERTEX_PROJECT");
    const location = readEnv(env, "VERTEX_LOCATION");
    const token = readEnv(env, "VERTEX_ACCESS_TOKEN");
    if (!project || !location || !token) return { status: "NOT_CONFIGURED" };
    return { status: "CONFIGURED", provider: new VertexProvider(model, project, location, token, fetchFn) };
  }
  return { status: "NOT_CONFIGURED" };
}
