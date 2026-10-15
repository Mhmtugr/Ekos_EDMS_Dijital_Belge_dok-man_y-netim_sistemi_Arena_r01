"use client";

// Onay akışını başlatır. Yayımlı onay matrisi yoksa sunucu WORKFLOW_NOT_STARTABLE döner; bu açıkça gösterilir.
import { useState } from "react";
import { useRouter } from "next/navigation";

export function WorkflowStart({ id, started }: { id: string; started: boolean }): React.JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  return (
    <div style={{ display: "grid", gap: "0.5rem", justifyItems: "start" }}>
      {started ? <p role="status" style={{ color: "#1a7f37", margin: 0 }}>Onay akışı başlatıldı; görevler onaycılara atandı.</p> : null}
      {started ? null : <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setMsg(null);
          void fetch(`/api/contracts/${id}/approval`, { method: "POST" })
            .then(async (res) => {
              const d = (await res.json().catch(() => ({}))) as { detail?: string; message?: string; code?: string };
              if (res.ok) {
                setMsg({ kind: "ok", text: "Onay akışı başlatıldı." });
                router.refresh();
              } else if (d.code === "WORKFLOW_NOT_STARTABLE" || d.code === "NO_APPROVAL_MATRIX") {
                setMsg({ kind: "err", text: "Yayımlı onay matrisi yok; onay akışı başlatılamaz. Yönetici matrisi yayımlamalıdır." });
              } else {
                setMsg({ kind: "err", text: d.detail ?? d.message ?? `Başlatılamadı (${d.code ?? String(res.status)})` });
              }
            })
            .catch(() => { setMsg({ kind: "err", text: "Sunucuya ulaşılamadı." }); })
            .finally(() => { setBusy(false); });
        }}
        style={{ padding: "0.4rem 0.9rem" }}
      >
        {busy ? "Başlatılıyor…" : "Onay akışını başlat"}
      </button>}
      {msg && !(started && msg.kind === "ok") ? (
        <p role={msg.kind === "err" ? "alert" : "status"} style={{ color: msg.kind === "err" ? "#9a1c1c" : "#1a7f37", margin: 0 }}>
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
