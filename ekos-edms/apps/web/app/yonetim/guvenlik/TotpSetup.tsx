"use client";

// İki adımlı doğrulama kurulumu: sır ve QR yalnızca bu oturumda gösterilir; onay kodu ile etkinleşir.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function TotpSetup(): React.JSX.Element {
  const router = useRouter();
  const [uri, setUri] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (uri === null) return;
    void QRCode.toDataURL(uri, { width: 220, margin: 1 }).then(setQr);
  }, [uri]);

  async function start(): Promise<void> {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/auth/totp/enroll", { method: "POST", headers: { Origin: window.location.origin }, credentials: "same-origin" });
      const data = (await res.json().catch(() => ({}))) as { otpauthUri?: string; secretBase32?: string; message?: string; code?: string };
      if (!res.ok || !data.otpauthUri || !data.secretBase32) {
        setMsg(data.message ?? "Kurulum başlatılamadı.");
        return;
      }
      setUri(data.otpauthUri);
      setSecret(data.secretBase32);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const raw = new FormData(e.currentTarget).get("code");
    const code = typeof raw === "string" ? raw.trim() : "";
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/auth/totp/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: window.location.origin },
        body: JSON.stringify({ code }),
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (res.ok) {
        setMsg("İki adımlı doğrulama etkinleştirildi.");
        setUri(null);
        setSecret(null);
        setQr(null);
        router.refresh();
      } else {
        setMsg(data.message ?? "Doğrulanamadı.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (uri === null) {
    return (
      <div>
        <button type="button" onClick={() => void start()} disabled={busy}>
          İki adımlı doğrulamayı kur
        </button>
        {msg !== null && <p role="alert">{msg}</p>}
      </div>
    );
  }

  return (
    <div>
      <ol>
        <li>Authenticator uygulamanızda (Google Authenticator, Microsoft Authenticator vb.) yeni hesap ekleyin.</li>
        <li>QR kodu tarayın veya gizli anahtarı elle girin.</li>
        <li>Uygulamanın gösterdiği 6 haneli kodu aşağıya girin.</li>
      </ol>
      {qr !== null && <img src={qr} alt="TOTP QR kodu" width={220} height={220} />}
      <p>
        Gizli anahtar: <code style={{ wordBreak: "break-all" }}>{secret}</code>
      </p>
      <form onSubmit={(e) => void confirm(e)} style={{ display: "flex", gap: "0.5rem" }}>
        <input name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required placeholder="000000" disabled={busy} style={{ padding: "0.4rem", width: 120 }} />
        <button type="submit" disabled={busy}>
          Onayla ve etkinleştir
        </button>
      </form>
      {msg !== null && <p role="alert">{msg}</p>}
    </div>
  );
}
