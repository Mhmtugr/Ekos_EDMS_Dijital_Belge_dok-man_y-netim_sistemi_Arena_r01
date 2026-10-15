"use client";

// Sözleşme alanları (başlangıç/bitiş, tutar, yenileme, ihbar). Yalnız taslak/incelemede; rowVersion çakışmasında 409.
import { useState } from "react";
import { useRouter } from "next/navigation";

export interface ContractFieldValues {
  startDate: string;
  endDate: string;
  effectiveDate: string;
  autoRenewal: "" | "true" | "false";
  amount: string;
  currency: string;
  paymentTerms: string;
  noticePeriodValue: string;
  noticePeriodUnit: "" | "CALENDAR_DAYS" | "CALENDAR_MONTHS";
}

export function ContractFieldsForm({ id, rowVersion, initial }: { id: string; rowVersion: number; initial: ContractFieldValues }): React.JSX.Element {
  const router = useRouter();
  const [v, setV] = useState<ContractFieldValues>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const set = <K extends keyof ContractFieldValues>(k: K, val: ContractFieldValues[K]): void => { setV((p) => ({ ...p, [k]: val })); };
  const field = { display: "block", width: "100%", padding: "0.4rem" } as const;

  function submit(e: React.SyntheticEvent<HTMLFormElement>): void {
    e.preventDefault();
    const nz = (s: string): string | null => (s.trim() === "" ? null : s.trim());
    const fields = {
      startDate: nz(v.startDate),
      endDate: nz(v.endDate),
      effectiveDate: nz(v.effectiveDate),
      autoRenewal: v.autoRenewal === "" ? null : v.autoRenewal === "true",
      amount: nz(v.amount),
      currency: nz(v.currency),
      paymentTerms: nz(v.paymentTerms),
      noticePeriodValue: v.noticePeriodValue.trim() === "" ? null : Number(v.noticePeriodValue),
      noticePeriodUnit: v.noticePeriodUnit === "" ? null : v.noticePeriodUnit,
    };
    setBusy(true);
    setMsg(null);
    void fetch(`/api/contracts/${id}/fields`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRowVersion: rowVersion, fields }),
    })
      .then(async (res) => {
        const d = (await res.json().catch(() => ({}))) as { detail?: string; message?: string; code?: string };
        if (res.ok) {
          setMsg({ kind: "ok", text: "Sözleşme alanları kaydedildi. Hatırlatmalar bir sonraki döngüde güncellenir." });
          router.refresh();
        } else if (res.status === 409) {
          setMsg({ kind: "err", text: "Kayıt başka biri tarafından değiştirildi. Sayfayı yenileyip tekrar deneyin." });
        } else {
          setMsg({ kind: "err", text: d.detail ?? d.message ?? `Kaydedilemedi (${d.code ?? String(res.status)})` });
        }
      })
      .catch(() => { setMsg({ kind: "err", text: "Sunucuya ulaşılamadı." }); })
      .finally(() => { setBusy(false); });
  }

  return (
    <form onSubmit={submit} aria-labelledby="alanlar-baslik" style={{ display: "grid", gap: "0.75rem", maxWidth: 640 }}>
      <h2 id="alanlar-baslik" style={{ fontSize: "1.1rem", margin: 0 }}>Sözleşme alanları</h2>
      <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <label>
          Yürürlük tarihi
          <input type="date" value={v.effectiveDate} onChange={(e) => { set("effectiveDate", e.target.value); }} style={field} />
        </label>
        <label>
          Başlangıç tarihi
          <input type="date" value={v.startDate} onChange={(e) => { set("startDate", e.target.value); }} style={field} />
        </label>
        <label>
          Bitiş tarihi
          <input type="date" value={v.endDate} onChange={(e) => { set("endDate", e.target.value); }} style={field} />
        </label>
        <label>
          Otomatik yenileme
          <select value={v.autoRenewal} onChange={(e) => { set("autoRenewal", e.target.value as ContractFieldValues["autoRenewal"]); }} style={field}>
            <option value="">Belirtilmedi</option>
            <option value="true">Evet</option>
            <option value="false">Hayır</option>
          </select>
        </label>
        <label>
          İhbar süresi (sayı)
          <input type="number" min={1} max={3650} value={v.noticePeriodValue} onChange={(e) => { set("noticePeriodValue", e.target.value); }} style={field} />
        </label>
        <label>
          İhbar birimi
          <select value={v.noticePeriodUnit} onChange={(e) => { set("noticePeriodUnit", e.target.value as ContractFieldValues["noticePeriodUnit"]); }} style={field}>
            <option value="">Belirtilmedi</option>
            <option value="CALENDAR_DAYS">Takvim günü</option>
            <option value="CALENDAR_MONTHS">Takvim ayı</option>
          </select>
        </label>
        <label>
          Tutar
          <input inputMode="decimal" placeholder="ör. 15000.00" value={v.amount} onChange={(e) => { set("amount", e.target.value); }} style={field} />
        </label>
        <label>
          Para birimi (ISO 4217)
          <input maxLength={3} placeholder="TRY" value={v.currency} onChange={(e) => { set("currency", e.target.value.toUpperCase()); }} style={field} />
        </label>
      </div>
      <label>
        Ödeme koşulları
        <textarea rows={2} maxLength={1000} value={v.paymentTerms} onChange={(e) => { set("paymentTerms", e.target.value); }} style={field} />
      </label>
      <div>
        <button type="submit" disabled={busy} style={{ padding: "0.4rem 0.9rem" }}>
          {busy ? "Kaydediliyor…" : "Alanları kaydet"}
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
