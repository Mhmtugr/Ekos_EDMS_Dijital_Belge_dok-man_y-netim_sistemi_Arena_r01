"use client";

// Tek bir sistem ayarının düzenleyicisi. Kritik ayarlar önerilir (PENDING); ikinci bir config.manage kullanıcısı onaylar.
// Gizli değerler (SMTP_URL, TEAMS_WEBHOOK_URL) ASLA girilmez: yalnızca ortam değişkeninin adı yazılır.
import { useState } from "react";
import { useRouter } from "next/navigation";

export interface SettingProps {
  key: string;
  label: string;
  critical: boolean;
  blocks: string;
  status: "COMPLETED" | "REQUIRED" | "UNVERIFIED";
  rowVersion: number;
  current: Record<string, unknown> | null;
  pending: { value: Record<string, unknown>; proposedById: string; proposedAt: string } | null;
  envReady: boolean;
}

const STATUS_LABEL: Record<SettingProps["status"], string> = { COMPLETED: "Tamamlandı", REQUIRED: "Gerekli", UNVERIFIED: "Onay bekliyor" };
const STATUS_COLOR: Record<SettingProps["status"], string> = { COMPLETED: "#1a7f37", REQUIRED: "#9a1c1c", UNVERIFIED: "#9a6700" };

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

export function SettingsEditor({ s, actorId }: { s: SettingProps; actorId: string }): React.JSX.Element {
  const router = useRouter();
  const base = s.pending?.value ?? s.current ?? {};
  const [offsets, setOffsets] = useState(Array.isArray((base as { offsets?: unknown }).offsets) ? ((base as { offsets: number[] }).offsets).join(", ") : "90, 60, 30, 15, 7, 1");
  const [enabled, setEnabled] = useState(base.enabled === true);
  const [secretRef, setSecretRef] = useState(str(base.secretRef, s.key.includes("teams") ? "TEAMS_WEBHOOK_URL" : "SMTP_URL"));
  const [from, setFrom] = useState(str(base.from));
  const [cap, setCap] = useState(String(typeof base.restrictedRowCap === "number" ? base.restrictedRowCap : 1000));
  const [frequency, setFrequency] = useState(str(base.frequency, "NONE"));
  const [owner, setOwner] = useState(str(base.owner));
  const [note, setNote] = useState(str(base.note));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function buildValue(): Record<string, unknown> | string {
    switch (s.key) {
      case "reminders.offsetDays":
        return { offsets: offsets.split(/[,\s]+/).filter(Boolean).map((x) => Number(x)) };
      case "notifications.email":
        return { enabled, secretRef: secretRef.trim(), from: from.trim() };
      case "notifications.teams":
        return { enabled, secretRef: secretRef.trim() };
      case "exports.policy":
        return { restrictedRowCap: Number(cap), watermark: true };
      case "backup.policy":
        return { frequency, owner: owner.trim(), note: note.trim() };
      default:
        return "UNKNOWN";
    }
  }

  function call(path: string, body: Record<string, unknown>, okText: string): void {
    setBusy(true);
    setMsg(null);
    void fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(async (res) => {
        const d = (await res.json().catch(() => ({}))) as { code?: string; detail?: string; status?: string };
        if (res.ok) {
          const text = path === "/api/settings" && d.status === "PENDING_SECOND_APPROVAL" ? "Öneri kaydedildi. Başka bir yönetici onaylayana kadar uygulanmaz." : okText;
          setMsg({ kind: "ok", text });
          router.refresh();
        } else if (res.status === 409 || d.code === "VERSION_CONFLICT") {
          setMsg({ kind: "err", text: "Ayar başka biri tarafından değiştirildi. Sayfayı yenileyip tekrar deneyin." });
        } else if (res.status === 403) {
          setMsg({ kind: "err", text: "Bu işlem için yetkiniz yok veya ikinci onay gerekiyor." });
        } else {
          setMsg({ kind: "err", text: d.detail ?? `İşlem başarısız (${d.code ?? String(res.status)})` });
        }
      })
      .catch(() => { setMsg({ kind: "err", text: "Bağlantı hatası" }); })
      .finally(() => { setBusy(false); });
  }

  const value = buildValue();
  const fieldId = (n: string): string => `${s.key}-${n}`.replace(/[^a-zA-Z0-9-]/g, "-");

  return (
    <article aria-labelledby={fieldId("baslik")} style={{ border: "1px solid #d0d7de", borderRadius: 8, padding: "1rem", display: "grid", gap: "0.75rem" }}>
      <header style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "baseline" }}>
        <h2 id={fieldId("baslik")} style={{ fontSize: "1.05rem", margin: 0 }}>{s.label}</h2>
        <span style={{ color: STATUS_COLOR[s.status], fontWeight: 600 }}>{STATUS_LABEL[s.status]}</span>
        {s.critical ? <span style={{ color: "#57606a" }}>(kritik: ikinci onay gerekir)</span> : null}
      </header>
      {s.status !== "COMPLETED" ? (
        <p style={{ margin: 0, color: "#57606a" }}>
          <strong>Yapılandırılmazsa:</strong> {s.blocks}
        </p>
      ) : null}
      {s.pending ? (
        <div role="status" style={{ background: "#fff8c5", border: "1px solid #d4a72c", borderRadius: 6, padding: "0.5rem 0.75rem" }}>
          <div>Onay bekleyen öneri: {new Date(s.pending.proposedAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
            {s.pending.proposedById !== actorId ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => { call("/api/settings/approve", { key: s.key, expectedRowVersion: s.rowVersion }, "Öneri onaylandı ve uygulandı."); }}
                style={{ padding: "0.3rem 0.8rem" }}
              >
                İkinci onayla
              </button>
            ) : (
              <span>Bu öneriyi siz yaptınız; başka bir yönetici onaylamalı.</span>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => { call("/api/settings/cancel", { key: s.key, expectedRowVersion: s.rowVersion }, "Öneri iptal edildi."); }}
              style={{ padding: "0.3rem 0.8rem" }}
            >
              Öneriyi iptal et
            </button>
          </div>
        </div>
      ) : null}

      <form
        aria-label={`${s.label} ayarı`}
        onSubmit={(e) => {
          e.preventDefault();
          if (typeof value === "string") return;
          call("/api/settings", { key: s.key, value, expectedRowVersion: s.rowVersion }, "Ayar kaydedildi.");
        }}
        style={{ display: "grid", gap: "0.6rem", maxWidth: 560 }}
      >
        {s.key === "reminders.offsetDays" ? (
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            Gün sayıları (virgülle)
            <input value={offsets} onChange={(e) => { setOffsets(e.target.value); }} inputMode="numeric" style={{ padding: "0.4rem" }} />
          </label>
        ) : null}

        {s.key === "notifications.email" || s.key === "notifications.teams" ? (
          <>
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); }} />
              Kanal etkin
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              Ortam değişkeni adı (değer burada girilmez)
              <input value={secretRef} onChange={(e) => { setSecretRef(e.target.value); }} autoComplete="off" style={{ padding: "0.4rem" }} aria-describedby={fieldId("gizli")} />
            </label>
            <small id={fieldId("gizli")} style={{ color: s.envReady ? "#1a7f37" : "#9a1c1c" }}>
              {s.envReady ? "Ortam değişkeni sunucuda tanımlı." : "Bu ortam değişkeni sunucuda tanımlı değil; kanal çalışmaz."}
            </small>
          </>
        ) : null}

        {s.key === "notifications.email" ? (
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            Gönderen e-posta adresi
            <input type="email" value={from} onChange={(e) => { setFrom(e.target.value); }} autoComplete="email" style={{ padding: "0.4rem" }} />
          </label>
        ) : null}

        {s.key === "exports.policy" ? (
          <>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              Kısıtlı indirme satır üst sınırı (100–5000)
              <input type="number" min={100} max={5000} value={cap} onChange={(e) => { setCap(e.target.value); }} style={{ padding: "0.4rem" }} />
            </label>
            <p style={{ margin: 0, color: "#57606a" }}>Hassas raporlarda filigran her zaman açıktır (zorunlu).</p>
          </>
        ) : null}

        {s.key === "backup.policy" ? (
          <>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              Yedekleme sıklığı
              <select value={frequency} onChange={(e) => { setFrequency(e.target.value); }} style={{ padding: "0.4rem" }}>
                <option value="DAILY">Günlük</option>
                <option value="WEEKLY">Haftalık</option>
                <option value="NONE">Yedekleme yok (kurum dışı)</option>
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              Sorumlu (en az 3 karakter)
              <input value={owner} onChange={(e) => { setOwner(e.target.value); }} maxLength={200} style={{ padding: "0.4rem" }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              Not
              <textarea value={note} onChange={(e) => { setNote(e.target.value); }} maxLength={1000} rows={2} style={{ padding: "0.4rem" }} />
            </label>
          </>
        ) : null}

        <div>
          <button type="submit" disabled={busy || typeof value === "string"} style={{ padding: "0.4rem 0.9rem" }}>
            {busy ? "Kaydediliyor…" : s.critical ? "Öner" : "Kaydet"}
          </button>
        </div>
        {msg ? (
          <p role={msg.kind === "err" ? "alert" : "status"} style={{ color: msg.kind === "err" ? "#9a1c1c" : "#1a7f37", margin: 0 }}>
            {msg.text}
          </p>
        ) : null}
      </form>
    </article>
  );
}
