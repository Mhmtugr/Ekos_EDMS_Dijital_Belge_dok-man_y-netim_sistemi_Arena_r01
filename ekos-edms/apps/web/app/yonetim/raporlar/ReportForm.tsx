"use client";

// Rapor formu: tür, biçim, filtreler. Dosya /api/reports/export üzerinden indirilir.
// Hassas raporlarda "kısıtlı indirme" seçeneği sunulur (dosya adı ve filigran KISITLI olur).
import { useState } from "react";
import { formText } from "@/lib/form-text";

const TYPES = [
  { value: "CONTRACT_PORTFOLIO", label: "Sözleşme portföyü", sensitive: true, dates: false },
  { value: "CONTRACT_DEADLINES", label: "Yaklaşan sözleşme süreleri", sensitive: false, dates: true },
  { value: "OBLIGATIONS_OPEN", label: "Açık yükümlülükler", sensitive: false, dates: false },
  { value: "APPROVALS_OPEN", label: "Açık onay görevleri", sensitive: false, dates: false },
  { value: "AUDIT_EXTRACT", label: "Denetim kayıtları (yalnız kurum geneli denetçi)", sensitive: true, dates: true },
] as const;

/** Yalnızca sunucunun bu kullanıcı için izin verdiği türler gösterilir (rapor sayfası hesaplar). */
export function ReportForm({ allowed }: { allowed: string[] }): React.JSX.Element {
  const available = TYPES.filter((t) => allowed.includes(t.value));
  const [type, setType] = useState<(typeof TYPES)[number]["value"]>(available[0]?.value ?? "CONTRACT_PORTFOLIO");
  const [format, setFormat] = useState<"CSV" | "XLSX">("XLSX");
  const [restricted, setRestricted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const def = TYPES.find((t) => t.value === type) ?? TYPES[0];
  if (available.length === 0) return <p role="alert">Rapor üretmek için yetkiniz yok.</p>;

  async function run(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body: Record<string, unknown> = { type, format, restricted: def.sensitive && restricted };
    const from = formText(fd.get("from"));
    const to = formText(fd.get("to"));
    const days = formText(fd.get("days"));
    if (from) body.from = from;
    if (to) body.to = to;
    if (days && type === "CONTRACT_DEADLINES") body.days = Number(days);
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/reports/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { detail?: string; code?: string };
        setMsg({ kind: "err", text: d.detail ?? `Dışa aktarma başarısız (${d.code ?? String(res.status)})` });
        return;
      }
      const cd = res.headers.get("Content-Disposition") ?? "";
      const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
      const name = m?.[1] ? decodeURIComponent(m[1]) : "rapor";
      const rows = res.headers.get("X-Row-Count") ?? "0";
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg({ kind: "ok", text: `Rapor indirildi: ${name} (${rows} kayıt). Dışa aktarma denetim kaydına yazıldı.` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void run(e)} aria-labelledby="rapor-baslik" style={{ display: "grid", gap: "0.75rem", maxWidth: 560 }}>
      <h2 id="rapor-baslik" style={{ fontSize: "1.05rem", margin: 0 }}>
        Rapor oluştur ve indir
      </h2>
      <label style={{ display: "flex", flexDirection: "column" }}>
        Rapor türü
        <select value={type} onChange={(e) => { setType(e.target.value as (typeof TYPES)[number]["value"]); }} style={{ padding: "0.4rem" }}>
          {available.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <fieldset style={{ border: "1px solid #d0d7de", borderRadius: 6, padding: "0.5rem 0.75rem" }}>
        <legend>Biçim</legend>
        <label style={{ marginRight: "1rem" }}>
          <input type="radio" name="format" value="XLSX" checked={format === "XLSX"} onChange={() => { setFormat("XLSX"); }} /> Excel (XLSX)
        </label>
        <label>
          <input type="radio" name="format" value="CSV" checked={format === "CSV"} onChange={() => { setFormat("CSV"); }} /> CSV
        </label>
      </fieldset>
      {def.dates ? (
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column" }}>
            Başlangıç
            <input type="date" name="from" style={{ padding: "0.4rem" }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column" }}>
            Bitiş
            <input type="date" name="to" style={{ padding: "0.4rem" }} />
          </label>
        </div>
      ) : null}
      {type === "CONTRACT_DEADLINES" ? (
        <p style={{ margin: 0, fontSize: "0.85rem", color: "#57606a" }}>Başlangıç/bitiş boşsa bugünden itibaren 90 gün alınır.</p>
      ) : null}
      {def.sensitive ? (
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "start" }}>
          <input type="checkbox" checked={restricted} onChange={(e) => { setRestricted(e.target.checked); }} />
          <span>
            Kısıtlı indirme: kayıt sayısı sınırlıdır; dosya adında ve filigranda KISITLI yazar. Hassas rapor olduğu için kurum politikası gereği kullanın.
          </span>
        </label>
      ) : null}
      <p style={{ margin: 0, fontSize: "0.85rem", color: "#57606a" }}>
        Rapor yalnızca yetkinizin gördüğü kayıtları içerir. Hassas raporlar filigranlanır.
      </p>
      <div>
        <button type="submit" disabled={busy} style={{ padding: "0.45rem 1rem" }}>
          {busy ? "Hazırlanıyor…" : "Raporu indir"}
        </button>
      </div>
      {msg ? (
        <p role={msg.kind === "err" ? "alert" : "status"} style={{ color: msg.kind === "err" ? "#9a1c1c" : "#1a7f37" }}>
          {msg.text}
        </p>
      ) : null}
    </form>
  );
}
