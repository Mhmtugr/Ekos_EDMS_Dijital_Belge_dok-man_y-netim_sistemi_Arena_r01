"use client";

import { useRouter } from "next/navigation";
import { useState, type CSSProperties } from "react";

const field: CSSProperties = { display: "block", width: "100%", padding: "0.5rem", marginTop: "0.25rem", marginBottom: "1rem" };

export function LoginForm(): React.JSX.Element {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [needsCode, setNeedsCode] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const rawTotp = fd.get("totpCode");
    const totp = typeof rawTotp === "string" ? rawTotp.trim() : "";
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: fd.get("email"),
          password: fd.get("password"),
          ...(needsCode && totp !== "" ? { totpCode: totp } : {}),
        }),
      });
      if (res.ok) {
        router.replace("/yonetim");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { code?: string };
      if (data.code === "TOTP_REQUIRED") {
        setNeedsCode(true);
        setError("Doğrulama uygulamanızdaki 6 haneli kodu girin.");
      } else if (res.status === 429) {
        setError("Çok fazla deneme. Lütfen 15 dakika sonra tekrar deneyin.");
      } else if (res.status === 503) {
        setError("Giriş şu an kullanılamıyor. Yöneticinize başvurun.");
      } else {
        // Tek tip mesaj: hangi alanın yanlış olduğu söylenmez.
        setNeedsCode(false);
        setError("E-posta, parola veya doğrulama kodu hatalı.");
      }
    } catch {
      setError("Sunucuya ulaşılamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)}>
      <label>
        E-posta
        <input name="email" type="email" autoComplete="username" required style={field} />
      </label>
      <label>
        Parola
        <input name="password" type="password" autoComplete="current-password" required style={field} />
      </label>
      {needsCode && (
        <label>
          Doğrulama kodu (6 hane)
          <input name="totpCode" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" required style={field} />
        </label>
      )}
      <button type="submit" disabled={busy}>
        {busy ? "Giriliyor…" : "Giriş yap"}
      </button>
      {error && (
        <p role="alert" style={{ color: "#cf222e" }}>
          {error}
        </p>
      )}
    </form>
  );
}
