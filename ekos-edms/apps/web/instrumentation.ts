// Sunucu başlangıcında üretim yapılandırma doğrulaması (Faz 7, madde 4). ERROR varsa uygulama başlamaz.
// Hata mesajlarında secret değerleri yer almaz: yalnız anahtar adı ve kural kodu.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { validateRuntimeConfig } = await import("@ekos/core");
  const report = validateRuntimeConfig(process.env, { production: process.env.NODE_ENV === "production" });
  for (const i of report.issues) {
    console.warn(`[config] ${i.severity} ${i.key} ${i.code}`);
  }
  if (!report.ok) {
    const keys = report.issues.filter((i) => i.severity === "ERROR").map((i) => `${i.key}:${i.code}`);
    throw new Error(`Yapılandırma hatası, uygulama başlatılmadı: ${keys.join(", ")}`);
  }
}
