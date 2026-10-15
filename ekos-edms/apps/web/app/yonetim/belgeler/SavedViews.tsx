"use client";

// Kayıtlı görünümler: mevcut arama kriterini kaydetme ve kendi görünümlerini silme.
// Kriter yalnızca sorguyu saklar; sonuçlar her açılışta yetki filtresiyle yeniden hesaplanır.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface ViewItem {
  readonly id: string;
  readonly name: string;
  readonly href: string;
}

export function SavedViews({ views, currentQuery }: { views: readonly ViewItem[]; currentQuery: string }): React.JSX.Element {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSave(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const form = e.currentTarget;
    const rawName = new FormData(form).get("name");
    const name = typeof rawName === "string" ? rawName.trim() : "";
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/saved-views", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: window.location.origin },
        body: JSON.stringify({ name, query: currentQuery }),
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
      if (res.ok) {
        form.reset();
        setMsg("Görünüm kaydedildi.");
        router.refresh();
      } else {
        setMsg(data.message ?? data.code ?? "Kaydedilemedi.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch(`/api/saved-views/${id}`, { method: "DELETE", headers: { Origin: window.location.origin }, credentials: "same-origin" });
      if (res.ok) router.refresh();
      else setMsg("Silinemedi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ marginTop: "2rem", borderTop: "1px solid #d0d7de", paddingTop: "1rem" }}>
      <h2 style={{ fontSize: "1rem" }}>Kayıtlı görünümlerim</h2>
      {views.length === 0 ? (
        <p>Henüz kayıtlı görünüm yok.</p>
      ) : (
        <ul>
          {views.map((v) => (
            <li key={v.id} style={{ marginBottom: "0.25rem" }}>
              <Link href={v.href}>{v.name}</Link>{" "}
              <button type="button" onClick={() => void onDelete(v.id)} disabled={busy} style={{ marginLeft: "0.5rem", fontSize: "0.75rem" }}>
                Sil
              </button>
            </li>
          ))}
        </ul>
      )}
      {currentQuery !== "" && (
        <form onSubmit={(e) => void onSave(e)} style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
          <input name="name" required maxLength={120} placeholder={`"${currentQuery}" için ad`} disabled={busy} style={{ padding: "0.4rem", flex: 1 }} />
          <button type="submit" disabled={busy}>
            Bu aramayı kaydet
          </button>
        </form>
      )}
      {msg !== null && <p role="status">{msg}</p>}
    </section>
  );
}
