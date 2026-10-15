"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi, field, messageOf } from "../gov-client";

export function DispositionForms({ reviewId, status, rowVersion }: { reviewId: string; status: string; rowVersion: number }): React.JSX.Element {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);

  async function decide(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const decision = field(fd, "decision");
    const reason = field(fd, "reason").trim();
    const extendedUntil = field(fd, "extendedUntil").trim();
    const physicalEvidenceRef = field(fd, "physicalEvidenceRef").trim();
    const r = await callApi("POST", `/api/disposal/reviews/${reviewId}/decision`, {
      decision,
      reason,
      expectedRowVersion: rowVersion,
      ...(decision === "EXTEND" && extendedUntil ? { extendedUntil } : {}),
      ...(physicalEvidenceRef ? { physicalEvidenceRef } : {}),
    });
    setMsg(messageOf(r, "Karar kaydedildi."));
    if (r.ok || r.status === 409) router.refresh();
  }

  if (status === "APPROVED") {
    return <span>Onaylandı; yürütme bekliyor.</span>;
  }

  return (
    <form onSubmit={(e) => void decide(e)} style={{ display: "grid", gap: "0.3rem", minWidth: 280 }}>
      <select name="decision" defaultValue="APPROVE" required>
        <option value="APPROVE">Onayla (inceleme veya ikinci onay)</option>
        <option value="EXTEND">Uzat</option>
        <option value="REJECT">Reddet (arşivde kalır)</option>
      </select>
      <input name="reason" required maxLength={2000} placeholder="Gerekçe (zorunlu)" />
      <input name="extendedUntil" type="date" placeholder="Uzatma tarihi (Uzat seçilirse)" />
      <input name="physicalEvidenceRef" maxLength={300} placeholder="Fiziksel imha kanıt referansı (gerekirse)" />
      <button type="submit">Kaydet</button>
      {msg && <p role="status">{msg}</p>}
    </form>
  );
}

export function SystemJobs(): React.JSX.Element {
  const [msg, setMsg] = useState<string | null>(null);
  async function run(url: string, label: string): Promise<void> {
    const r = await callApi("POST", url, {});
    if (!r.ok) {
      setMsg(messageOf(r, label));
      return;
    }
    setMsg(`${label}: ${JSON.stringify(r.data).slice(0, 400)}`);
  }
  return (
    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
      <button type="button" onClick={() => void run("/api/disposal/scan", "Tarama tamamlandı")}>
        Süre dolumu taraması çalıştır
      </button>
      <button type="button" onClick={() => void run("/api/disposal/worker", "Yürütücü tamamlandı")}>
        Onaylıları yürüt
      </button>
      {msg && <p role="status" style={{ width: "100%" }}>{msg}</p>}
    </div>
  );
}
