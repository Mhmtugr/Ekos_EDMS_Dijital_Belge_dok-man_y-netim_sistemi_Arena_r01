"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi, field, messageOf } from "../gov-client";

export function BreakGlassRequestForm(): React.JSX.Element {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  async function onSubmit(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const r = await callApi("POST", "/api/breakglass", {
      documentId: field(fd, "documentId").trim(),
      permission: field(fd, "permission").trim(),
      reason: field(fd, "reason").trim(),
      durationMinutes: Number(fd.get("durationMinutes") ?? 0),
    });
    setMsg(messageOf(r, "Talep oluşturuldu; ikinci onay bekleniyor."));
    if (r.ok) {
      form.reset();
      router.refresh();
    }
  }
  return (
    <form onSubmit={(e) => void onSubmit(e)} style={{ display: "grid", gap: "0.4rem", maxWidth: 560 }}>
      <input name="documentId" required placeholder="Belge kimliği (UUID)" />
      <input name="permission" required maxLength={80} placeholder="Yetki kodu (ör. document.view_content)" />
      <textarea name="reason" required maxLength={2000} placeholder="Gerekçe (zorunlu)" />
      <input name="durationMinutes" type="number" min={1} max={1440} required placeholder="Süre (dakika, en fazla 1440)" />
      <button type="submit">Talep et</button>
      {msg && <p role="status">{msg}</p>}
    </form>
  );
}

export function BreakGlassActions({
  grantId,
  status,
  isRequester,
  canApprove,
}: {
  grantId: string;
  status: string;
  isRequester: boolean;
  canApprove: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  async function run(body: Record<string, unknown>, ok: string): Promise<void> {
    const r = await callApi("POST", `/api/breakglass/${grantId}`, body);
    setMsg(messageOf(r, ok));
    if (r.ok || r.status === 409) router.refresh();
  }
  const reasonInput = (
    <input name="reason" id={`r-${grantId}`} placeholder="Gerekçe" maxLength={2000} style={{ minWidth: 160 }} />
  );
  const readReason = (): string => (document.getElementById(`r-${grantId}`) as HTMLInputElement | null)?.value.trim() ?? "";

  return (
    <div style={{ display: "grid", gap: "0.3rem" }}>
      {status === "REQUESTED" && canApprove && !isRequester && (
        <>
          <button type="button" onClick={() => void run({ action: "approve" }, "Talep onaylandı.")}>
            Onayla
          </button>
          {reasonInput}
          <button type="button" onClick={() => void run({ action: "reject", reason: readReason() }, "Talep reddedildi.")}>
            Reddet
          </button>
        </>
      )}
      {status === "APPROVED" && canApprove && (
        <>
          {reasonInput}
          <button type="button" onClick={() => void run({ action: "revoke", reason: readReason() }, "Erişim iptal edildi.")}>
            İptal et
          </button>
        </>
      )}
      {status === "REQUESTED" && isRequester && <span>Kendi talebiniz: başka biri onaylamalı.</span>}
      {msg && <span role="status">{msg}</span>}
    </div>
  );
}
