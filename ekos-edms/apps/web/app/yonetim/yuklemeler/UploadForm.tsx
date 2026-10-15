"use client";

import { useState } from "react";

interface TypeOption {
  readonly code: string;
  readonly name: string;
  readonly requiredKeys: readonly string[];
}

interface CounterpartyOption {
  readonly id: string;
  readonly officialName: string;
  readonly countryCode: string;
}

interface Duplicate {
  readonly documentId: string;
  readonly number: string;
  readonly title: string;
}

const SCAN_LABEL: Record<string, string> = {
  CLEAN: "Tarandı: temiz",
  INFECTED: "Tarandı: virüs bulundu (dosya reddedildi)",
  UNAVAILABLE: "Tarama servisi yanıt vermedi; dosya karantinada",
  NOT_CONFIGURED: "Tarama servisi yapılandırılmadı; dosya karantinada, belge hazır olmaz",
  ERROR: "Tarama sırasında hata; dosya karantinada",
};

const field = { display: "block", width: "100%", padding: "0.4rem" } as const;

interface DepartmentOption {
  readonly id: string;
  readonly name: string;
}

export function UploadForm({
  types,
  counterparties,
  departments,
}: {
  types: readonly TypeOption[];
  counterparties: readonly CounterpartyOption[];
  departments: readonly DepartmentOption[];
}): React.JSX.Element {
  const [msg, setMsg] = useState<string | null>(null);
  const [dups, setDups] = useState<readonly Duplicate[]>([]);
  const [busy, setBusy] = useState(false);
  const [typeCode, setTypeCode] = useState(types[0]?.code ?? "");
  const requiredKeys = types.find((t) => t.code === typeCode)?.requiredKeys ?? [];
  const requiresCp = requiredKeys.includes("counterpartyId");
  const requiresAmount = requiredKeys.includes("amount");
  const requiresCurrency = requiredKeys.includes("currency");

  async function onSubmit(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setDups([]);
    const form = e.currentTarget;
    try {
      const res = await fetch("/api/documents/upload", { method: "POST", body: new FormData(form) });
      const body = (await res.json()) as { number?: string; scan?: string; message?: string; detail?: string; code?: string; duplicates?: Duplicate[] };
      if (res.status === 201) {
        setMsg(`Belge oluşturuldu: ${body.number ?? ""}. ${SCAN_LABEL[body.scan ?? ""] ?? ""}`);
        setDups(body.duplicates ?? []);
        form.reset();
        setTypeCode(types[0]?.code ?? "");
      } else {
        const detail = body.message ?? body.detail ?? "Dosya kabul edilmedi";
        setMsg(`Yükleme başarısız (${body.code ?? String(res.status)}): ${detail}`);
      }
    } catch {
      setMsg("Sunucuya ulaşılamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} style={{ display: "grid", gap: "0.75rem", maxWidth: 520 }}>
      <label>
        Belge türü
        <select name="typeCode" required value={typeCode} onChange={(e) => {
            setTypeCode(e.target.value);
          }} style={field}>
          {types.map((t) => (
            <option key={t.code} value={t.code}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Karşı taraf{requiresCp ? " (zorunlu)" : " (isteğe bağlı)"}
        <select name="counterpartyId" required={requiresCp} defaultValue="" style={field}>
          <option value="">— Seçiniz —</option>
          {counterparties.map((c) => (
            <option key={c.id} value={c.id}>
              {c.officialName} ({c.countryCode})
            </option>
          ))}
        </select>
        {counterparties.length === 0 && <small>Aktif karşı taraf yok. Önce “Karşı taraflar” ekranından ekleyin.</small>}
      </label>
      {requiresAmount && (
        <label>
          Tutar (zorunlu)
          <input name="amount" required inputMode="decimal" placeholder="ör. 15000.00" pattern="-?\d+(\.\d{1,4})?" style={field} />
        </label>
      )}
      {requiresCurrency && (
        <label>
          Para birimi (zorunlu, ISO 4217)
          <input name="currency" required maxLength={3} pattern="[A-Za-z]{3}" placeholder="TRY" style={field} />
        </label>
      )}
      {departments.length > 0 && (
        <label>
          Birim{departments.length > 1 ? " (zorunlu)" : " (isteğe bağlı)"}
          <select name="departmentId" required={departments.length > 1} defaultValue={departments.length === 1 ? departments[0]?.id : ""} style={field}>
            {departments.length > 1 && <option value="">— Seçiniz —</option>}
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Başlık
        <input name="title" required maxLength={300} style={field} />
      </label>
      <label>
        Belge tarihi
        <input name="documentDate" type="date" required style={field} />
      </label>
      <label>
        Dosya (PDF, PNG, JPEG, TIFF, DOCX, XLSX; en fazla 50 MB)
        <input name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.docx,.xlsx" />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? "Yükleniyor…" : "Yükle"}
      </button>
      {msg && <p role="status">{msg}</p>}
      {dups.length > 0 && (
        <div role="alert" style={{ border: "1px solid #bf8700", padding: "0.5rem", background: "#fff8c5" }}>
          <strong>Uyarı: aynı dosya içeriği zaten kayıtlı (SHA-256 birebir eşleşme).</strong>
          <ul>
            {dups.map((d) => (
              <li key={d.documentId}>
                <a href={`/yonetim/belgeler/${d.documentId}`}>{d.number}</a> — {d.title}
              </li>
            ))}
          </ul>
          <small>Yükleme tamamlandı; kopyayı kaldırmak sizin kararınızdır.</small>
        </div>
      )}
    </form>
  );
}
