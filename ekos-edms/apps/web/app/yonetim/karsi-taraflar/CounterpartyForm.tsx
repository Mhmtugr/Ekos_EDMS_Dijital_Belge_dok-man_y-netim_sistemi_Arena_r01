"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CounterpartyForm(): React.JSX.Element {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const text = (key: string): string => {
      const v = fd.get(key);
      return typeof v === "string" ? v : "";
    };
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/counterparties", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: window.location.origin },
        body: JSON.stringify({
          officialName: text("officialName"),
          countryCode: text("countryCode"),
          supplierCode: text("supplierCode"),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; detail?: string };
      if (res.status === 201) {
        setMsg("Karşı taraf eklendi.");
        e.currentTarget.reset();
        router.refresh();
      } else {
        setMsg(body.detail ?? body.message ?? "Kayıt başarısız.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} style={{ display: "grid", gap: "0.5rem", maxWidth: 480 }}>
      <input name="officialName" required minLength={2} maxLength={300} placeholder="Resmi ad" />
      <input name="countryCode" required pattern="[A-Za-z]{2}" maxLength={2} placeholder="Ülke (ör. TR)" />
      <input name="supplierCode" maxLength={60} placeholder="Tedarikçi kodu (isteğe bağlı)" />
      <button type="submit" disabled={busy}>
        Ekle
      </button>
      {msg && <p role="status">{msg}</p>}
    </form>
  );
}
