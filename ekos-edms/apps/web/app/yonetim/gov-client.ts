// İstemci yardımcısı: Faz 4 API çağrıları (aynı-köken Origin başlığı ile).
export interface ApiResult {
  readonly ok: boolean;
  readonly status: number;
  readonly data: Record<string, unknown>;
}

export async function callApi(method: "GET" | "POST" | "PATCH", url: string, body?: unknown): Promise<ApiResult> {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

/** Hata metni: servis ayrıntısı (detail) öncelikli; yoksa kod. */
export function messageOf(r: ApiResult, success: string): string {
  if (r.ok) return success;
  const detail = typeof r.data.detail === "string" ? r.data.detail : null;
  const code = typeof r.data.code === "string" ? r.data.code : `HTTP ${String(r.status)}`;
  return detail ? `${detail} (${code})` : `İşlem başarısız: ${code}`;
}

/** FormData alanını metin olarak okur; dosya veya yoksa boş metin. */
export function field(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}
