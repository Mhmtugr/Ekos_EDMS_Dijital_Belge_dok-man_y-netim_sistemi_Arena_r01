"use client";

// Yeni sözleşme kaydı (taslak). Sunucu belge türünü, karşı tarafı ve birimi yeniden doğrular.
import { useState } from "react";
import { useRouter } from "next/navigation";

export function NewContractForm({
  counterparties,
  departments,
}: {
  counterparties: readonly { id: string; officialName: string; countryCode: string }[];
  departments: readonly { id: string; name: string }[];
}): React.JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const field = { display: "block", width: "100%", padding: "0.4rem" } as const;

  function submit(e: React.SyntheticEvent<HTMLFormElement>): void {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setMsg(null);
    void fetch("/api/contracts/upload", { method: "POST", body: f })
      .then(async (res) => {
        const d = (await res.json().catch(() => ({}))) as { contractId?: string; scan?: string; message?: string; detail?: string; code?: string };
        if (res.status === 201 && d.contractId) {
          // Tarama sonucu açıkça belirtilir; taranmamış dosya ile imza yapılamaz.
          const q = d.scan && d.scan !== "CLEAN" ? "?tarama=" + encodeURIComponent(d.scan) : "";
          router.push(`/yonetim/sozlesmeler/${d.contractId}${q}`);
          return;
        }
        setMsg({ kind: "err", text: d.detail ?? d.message ?? `Kaydedilemedi (${d.code ?? String(res.status)})` });
      })
      .catch(() => { setMsg({ kind: "err", text: "Sunucuya ulaşılamadı." }); })
      .finally(() => { setBusy(false); });
  }

  return (
    <form onSubmit={submit} aria-label="Yeni sözleşme" style={{ display: "grid", gap: "0.75rem", maxWidth: 560 }}>
      <label>
        Başlık
        <input name="title" required maxLength={400} style={field} />
      </label>
      <label>
        Karşı taraf (zorunlu)
        <select name="counterpartyId" required defaultValue="" style={field}>
          <option value="">— Seçiniz —</option>
          {counterparties.map((c) => (
            <option key={c.id} value={c.id}>
              {c.officialName} ({c.countryCode})
            </option>
          ))}
        </select>
        {counterparties.length === 0 ? <small>Aktif karşı taraf yok. Önce “Karşı taraflar” ekranından ekleyin.</small> : null}
      </label>
      {departments.length > 0 ? (
        <label>
          Birim{departments.length > 1 ? " (zorunlu)" : " (isteğe bağlı)"}
          <select name="departmentId" required={departments.length > 1} defaultValue={departments.length === 1 ? departments[0]?.id : ""} style={field}>
            {departments.length > 1 ? <option value="">— Seçiniz —</option> : null}
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label>
        Belge tarihi
        <input name="documentDate" type="date" required style={field} />
      </label>
      <label>
        Sözleşme dosyası (zorunlu)
        <input name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.docx,.xlsx" style={field} />
        <small>PDF, Word, Excel veya görüntü; en çok 50 MB. Dosya taranmadan imzalanamaz.</small>
      </label>
      <div>
        <button type="submit" disabled={busy || counterparties.length === 0} style={{ padding: "0.45rem 1rem" }}>
          {busy ? "Yükleniyor…" : "Dosyalı taslak sözleşme oluştur"}
        </button>
      </div>
      <p style={{ color: "#57606a", margin: 0, fontSize: "0.9rem" }}>
        Oluşturulan taslakta bitiş tarihi, ihbar süresi ve tutar sözleşme ekranından girilir; hatırlatmalar bu alanlara göre üretilir.
      </p>
      {msg ? (
        <p role={msg.kind === "err" ? "alert" : "status"} style={{ color: msg.kind === "err" ? "#9a1c1c" : "#1a7f37", margin: 0 }}>
          {msg.text}
        </p>
      ) : null}
    </form>
  );
}
