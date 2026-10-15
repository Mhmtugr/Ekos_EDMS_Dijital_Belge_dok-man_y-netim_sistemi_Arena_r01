"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi, field, messageOf } from "../gov-client";

export function FiscalYearForm(): React.JSX.Element {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  async function onSubmit(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const year = Number(field(fd, "year"));
    const endDate = field(fd, "endDate");
    const rv = field(fd, "expectedRowVersion");
    const r = await callApi("POST", "/api/governance/fiscal-year-ends", {
      year,
      endDate,
      expectedRowVersion: rv === "" ? null : Number(rv),
    });
    setMsg(messageOf(r, "Mali yıl sonu kaydedildi."));
    if (r.ok || r.status === 409) router.refresh();
  }
  return (
    <form onSubmit={(e) => void onSubmit(e)} style={{ display: "grid", gap: "0.4rem", maxWidth: 420 }}>
      <input name="year" type="number" min={1900} max={2200} required placeholder="Yıl (ör. 2025)" />
      <input name="endDate" type="date" required />
      <input name="expectedRowVersion" type="number" min={1} placeholder="Mevcut sürüm (yeni yılda boş bırakın)" />
      <button type="submit">Kaydet</button>
      {msg && <p role="status">{msg}</p>}
    </form>
  );
}
