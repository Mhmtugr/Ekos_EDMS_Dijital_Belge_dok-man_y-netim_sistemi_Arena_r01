"use client";

// Toplu içe aktarma: 1) dosya havuzu (her dosya ayrı istek, karantina + tarama), 2) CSV manifest.
// Manifest, dosya adlarını havuzdaki dosyalarla eşleştirir. Sahte başarı yok: rapor yalnızca sunucu yanıtından gelir.
import { useState } from "react";

interface RowError {
  readonly rowNumber: number;
  readonly line: number;
  readonly code: string;
  readonly message: string;
}

interface Report {
  readonly status: string;
  readonly totalRows: number;
  readonly okRows: number;
  readonly errorRows: number;
  readonly errors: readonly RowError[];
}

interface ApiBody {
  readonly code?: string;
  readonly message?: string;
  readonly detail?: string;
  readonly scan?: string;
  readonly fileName?: string;
}

function errText(data: ApiBody, status: number): string {
  return `${data.message ?? data.code ?? "Hata"}${data.detail ? ` — ${data.detail}` : ""} (HTTP ${String(status)})`;
}

const SCAN_LABEL: Record<string, string> = {
  CLEAN: "temiz",
  INFECTED: "virüs bulundu",
  UNAVAILABLE: "tarama yanıt vermedi",
  NOT_CONFIGURED: "tarama yapılandırılmadı",
};

export function ImportForm(): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [staged, setStaged] = useState<string[]>([]);
  const [report, setReport] = useState<Report | null>(null);

  async function onStage(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("files") as HTMLInputElement | null;
    const files = Array.from(input?.files ?? []);
    if (files.length === 0) return;
    setBusy(true);
    setMsg(null);
    const lines: string[] = [];
    for (const f of files) {
      const fd = new FormData();
      fd.set("file", f);
      try {
        const res = await fetch("/api/import/staging-files", { method: "POST", headers: { Origin: window.location.origin }, body: fd, credentials: "same-origin" });
        const data = (await res.json().catch(() => ({}))) as ApiBody;
        lines.push(res.ok ? `${f.name}: ${SCAN_LABEL[data.scan ?? ""] ?? data.scan ?? "?"}` : `${f.name}: ${errText(data, res.status)}`);
      } catch {
        lines.push(`${f.name}: bağlantı hatası`);
      }
    }
    setStaged((prev) => [...prev, ...lines]);
    e.currentTarget.reset();
    setBusy(false);
  }

  async function onManifest(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setMsg(null);
    setReport(null);
    try {
      const res = await fetch("/api/import/manifest", { method: "POST", headers: { Origin: window.location.origin }, body: new FormData(form), credentials: "same-origin" });
      const data = (await res.json().catch(() => ({}))) as Partial<Report> & ApiBody;
      if (!res.ok) setMsg(errText(data, res.status));
      else {
        setReport(data as Report);
        form.reset();
      }
    } catch {
      setMsg("Bağlantı hatası; içe aktarma tamamlanmadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 style={{ fontSize: "1rem" }}>1) Dosya havuzu</h2>
      <p style={{ color: "#57606a", fontSize: "0.85rem" }}>Manifestte geçen dosyaları seçin. Her dosya karantinaya alınır ve taranır; manifest ad eşleşmesiyle bunları kullanır.</p>
      <form onSubmit={(e) => void onStage(e)} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <input name="files" type="file" multiple disabled={busy} />
        <button type="submit" disabled={busy}>Havuza ekle</button>
      </form>
      {staged.length > 0 && (
        <ul style={{ fontSize: "0.85rem" }}>
          {staged.map((s, i) => (
            <li key={`${String(i)}-${s}`}>{s}</li>
          ))}
        </ul>
      )}

      <h2 style={{ fontSize: "1rem", marginTop: "1.5rem" }}>2) CSV manifest</h2>
      <p style={{ color: "#57606a", fontSize: "0.85rem" }}>
        Zorunlu sütunlar: fileName, documentTypeCode, title, documentDate (YYYY-AA-GG). Hatalı satırlar satır numarasıyla raporlanır; geçerli satırlar yine işlenir.
      </p>
      <form onSubmit={(e) => void onManifest(e)} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <input name="file" type="file" accept=".csv,text/csv" required disabled={busy} />
        <button type="submit" disabled={busy}>{busy ? "İşleniyor…" : "İçe aktar"}</button>
      </form>
      {msg !== null && (
        <p role="alert" style={{ color: "#cf222e", marginTop: "1rem" }}>
          {msg}
        </p>
      )}
      {report !== null && (
        <div style={{ marginTop: "1rem" }}>
          <p>
            Durum: <strong>{report.status}</strong> · Toplam satır: {report.totalRows} · Başarılı: {report.okRows} · Hatalı: {report.errorRows}
          </p>
          {report.errors.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #d0d7de" }}>
                  <th>Satır (dosya)</th>
                  <th>Veri satırı</th>
                  <th>Kod</th>
                  <th>Açıklama</th>
                </tr>
              </thead>
              <tbody>
                {report.errors.map((r) => (
                  <tr key={`${String(r.rowNumber)}-${r.code}-${String(r.line)}`} style={{ borderBottom: "1px solid #eaeef2" }}>
                    <td>{r.line}</td>
                    <td>{r.rowNumber}</td>
                    <td>{r.code}</td>
                    <td>{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
