"use client";

// İmza kanıtı kaydı. Kanıt yoksa sözleşme AKTİF olmaz (sunucu kuralı). Gizli değer alınmaz.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formText } from "@/lib/form-text";

export function SignatureForm({ id, active }: { id: string; active: boolean }): React.JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const field = { display: "block", width: "100%", padding: "0.4rem" } as const;
  if (active) {
    // Hook'lar koşulsuz çağrılır; yürürlük sonrası yalnız durum mesajı gösterilir.
    return (
      <p role="status" style={{ color: "#1a7f37", margin: 0 }}>
        {msg?.kind === "ok" ? msg.text : "Sözleşme yürürlükte; imza kanıtı kayıtlı."}
      </p>
    );
  }
  return (
    <form
      aria-labelledby="imza-baslik"
      style={{ display: "grid", gap: "0.6rem", maxWidth: 520 }}
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setMsg(null);
        void fetch(`/api/contracts/${id}/signature`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            signedAt: formText(f.get("signedAt")),
            signatureMethod: formText(f.get("signatureMethod")).trim(),
            signerSummary: formText(f.get("signerSummary")).trim(),
          }),
        })
          .then(async (res) => {
            const d = (await res.json().catch(() => ({}))) as { detail?: string; message?: string; code?: string };
            if (res.ok) {
              setMsg({ kind: "ok", text: "İmza kanıtı kaydedildi; sözleşme aktif oldu." });
              router.refresh();
            } else setMsg({ kind: "err", text: d.detail ?? d.message ?? `Kaydedilemedi (${d.code ?? String(res.status)})` });
          })
          .catch(() => { setMsg({ kind: "err", text: "Sunucuya ulaşılamadı." }); })
          .finally(() => { setBusy(false); });
      }}
    >
      <h2 id="imza-baslik" style={{ fontSize: "1.1rem", margin: 0 }}>İmza kaydı</h2>
      <label>
        İmza tarihi
        <input name="signedAt" type="date" required style={field} />
      </label>
      <label>
        İmza yöntemi
        <input name="signatureMethod" required maxLength={80} placeholder="ör. Islak imza (taranmış kopya)" style={field} />
      </label>
      <label>
        İmzacı(lar)
        <input name="signerSummary" required maxLength={1000} placeholder="ör. Ad Soyad, Şirket Yetkilisi" style={field} />
      </label>
      <div>
        <button type="submit" disabled={busy} style={{ padding: "0.4rem 0.9rem" }}>
          {busy ? "Kaydediliyor…" : "İmza kanıtını kaydet"}
        </button>
      </div>
      {msg ? (
        <p role={msg.kind === "err" ? "alert" : "status"} style={{ color: msg.kind === "err" ? "#9a1c1c" : "#1a7f37", margin: 0 }}>
          {msg.text}
        </p>
      ) : null}
    </form>
  );
}
