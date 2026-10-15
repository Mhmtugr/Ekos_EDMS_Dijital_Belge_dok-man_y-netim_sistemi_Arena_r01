// Gemini ve Vertex AI (generateContent) için ortak istek/yanıt işleme. Yanıt metni JSON olarak ayrıştırılır; ham metin günlüğe yazılmaz.
import type { AiResult } from "./types.js";

export function buildGenerateBody(system: string, user: string): unknown {
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  };
}

export async function postGenerate(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number, fetchFn: typeof fetch): Promise<AiResult> {
  let res: Response;
  try {
    res = await fetchFn(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return { ok: false, code: "AI_UNREACHABLE" };
  }
  if (!res.ok) return { ok: false, code: `AI_HTTP_${String(res.status)}` };
  const data = (await res.json().catch(() => null)) as { candidates?: { content?: { parts?: { text?: unknown }[] } }[] } | null;
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => (typeof p.text === "string" ? p.text : "")).join("") ?? "";
  if (text.length === 0) return { ok: false, code: "AI_EMPTY" };
  try {
    return { ok: true, json: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, code: "AI_NOT_JSON" };
  }
}
