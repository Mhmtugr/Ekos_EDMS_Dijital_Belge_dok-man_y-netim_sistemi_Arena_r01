// Global kurulum: her test kullanıcısı için oturumu BİR KEZ açar. Giriş uç noktasında IP başına 15 dakikada 30 deneme
// sınırı vardır; her testte yeniden giriş yapmak bu sınıra takılır. Oturum çerezleri diske yazılmaz; ortam değişkeninde
// (worker'lara miras kalır) taşınır. Çıkış testi kendi taze oturumunu açar, paylaşılan oturumları iptal etmez.
import type { FullConfig } from "@playwright/test";

const USERS = ["yonetici", "onayci", "denetci", "kullanici", "sozlesme", "guvenlik"] as const;

export default async function globalSetup(config: FullConfig): Promise<void> {
  const password = process.env["EKOS_DEV_PASSWORD"];
  if (!password) return; // Testler kendi skip mantığıyla atlanır.
  const baseURL = (config.projects[0]?.use.baseURL) ?? "http://localhost:3000";
  const sessions: Record<string, string> = {};
  for (const u of USERS) {
    const email = `${u}@ekos.test`;
    const res = await fetch(new URL("/api/auth/login", baseURL), {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: new URL(baseURL).origin },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error(`E2E kurulumu: ${email} girişi başarısız (${String(res.status)})`);
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith("ekos_session="));
    if (!cookie) throw new Error(`E2E kurulumu: ${email} için oturum çerezi yok`);
    sessions[email] = cookie.slice("ekos_session=".length).split(";")[0] ?? "";
  }
  process.env["EKOS_E2E_SESSIONS"] = JSON.stringify(sessions);
}
