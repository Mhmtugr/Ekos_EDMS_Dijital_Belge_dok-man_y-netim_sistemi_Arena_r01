"use client";

// Hatırlatma aralıkları (gün). Sunucu doğrular (1–365, benzersiz, en fazla 12); rowVersion çakışmasında 409.
import { useState } from "react";
import { useRouter } from "next/navigation";

export function OffsetsForm({ initial, rowVersion }: { initial: number[]; rowVersion: number }): React.JSX.Element {
  const router = useRouter();
  const [text, setText] = useState(initial.join(", "));
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function submit(e: React.SyntheticEvent<HTMLFormElement>): void {
    e.preventDefault();
    setMsg(null);
    const offsets = text
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => Number(s));
    if (offsets.length === 0 || offsets.some((n) => !Number.isInteger(n))) {
      setMsg({ kind: "err", text: "Aralıklar virgülle ayrılmış tam sayılar olmalı (ör. 90, 60, 30)." });
      return;
    }
    setBusy(true);
    void fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "reminders.offsetDays", value: { offsets }, expectedRowVersion: rowVersion }),
    })
      .then(async (res) => {
        const d = (await res.json().catch(() => ({}))) as { code?: string; detail?: string };
        if (res.ok) {
          setMsg({ kind: "ok", text: "Hatırlatma aralıkları kaydedildi. Tarihler bir sonraki döngüde yeniden hesaplanır." });
          router.refresh();
        } else if (res.status === 409 || d.code === "VERSION_CONFLICT") {
          setMsg({ kind: "err", text: "Ayar başka biri tarafından değiştirildi. Sayfayı yenileyip tekrar deneyin." });
        } else {
          setMsg({ kind: "err", text: d.detail ?? `Kaydedilemedi (${d.code ?? String(res.status)})` });
        }
      })
      .catch(() => { setMsg({ kind: "err", text: "Bağlantı hatası" }); })
      .finally(() => { setBusy(false); });
  }

  return (
    <form onSubmit={submit} aria-labelledby="ofs-baslik" style={{ display: "grid", gap: "0.5rem", maxWidth: 480 }}>
      <h2 id="ofs-baslik" style={{ fontSize: "1.05rem", margin: 0 }}>Hatırlatma aralıkları</h2>
      <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        Gün sayıları (virgülle)
        <input value={text} onChange={(e) => { setText(e.target.value); }} inputMode="numeric" style={{ padding: "0.4rem" }} aria-describedby="ofs-yardim" />
      </label>
      <small id="ofs-yardim" style={{ color: "#57606a" }}>1–365 arası, en fazla 12 benzersiz değer. Varsayılan: 90, 60, 30, 15, 7, 1.</small>
      <div>
        <button type="submit" disabled={busy} style={{ padding: "0.4rem 0.9rem" }}>
          {busy ? "Kaydediliyor…" : "Aralıkları kaydet"}
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
