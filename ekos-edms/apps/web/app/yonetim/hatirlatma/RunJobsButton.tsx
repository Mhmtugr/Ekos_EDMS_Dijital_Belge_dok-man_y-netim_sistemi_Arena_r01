"use client";

// Hatırlatma döngüsü + bildirim teslimini elle çalıştırır ve sonucu özetler.
import { useState } from "react";
import { useRouter } from "next/navigation";

interface JobsResult {
  reminders: { created: number; cancelled: number; desired: number; fired: number; suppressed: number; notifications: number; unrouted: number };
  delivery: { processed: number; sent: number; notConfigured: number; retryScheduled: number; dead: number };
}

export function RunJobsButton(): React.JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<JobsResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      <div>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setErr(null);
            setResult(null);
            void fetch("/api/jobs/run", { method: "POST" })
              .then(async (res) => {
                const d = (await res.json().catch(() => ({}))) as JobsResult & { code?: string; detail?: string };
                if (res.ok) {
                  setResult(d);
                  router.refresh();
                } else setErr(d.detail ?? `Çalıştırılamadı (${d.code ?? String(res.status)})`);
              })
              .catch(() => { setErr("Bağlantı hatası"); })
              .finally(() => { setBusy(false); });
          }}
          style={{ padding: "0.4rem 0.9rem" }}
        >
          {busy ? "Çalışıyor…" : "Hatırlatma ve teslimi şimdi çalıştır"}
        </button>
      </div>
      {err ? <p role="alert" style={{ color: "#9a1c1c", margin: 0 }}>{err}</p> : null}
      {result ? (
        <div role="status" style={{ border: "1px solid #d0d7de", borderRadius: 8, padding: "0.75rem", fontSize: "0.9rem" }}>
          <div>
            Hatırlatma: {result.reminders.created} yeni olay, {result.reminders.cancelled} iptal, {result.reminders.fired} tetiklendi,{" "}
            {result.reminders.notifications} bildirim üretildi, {result.reminders.suppressed} bastırıldı.
          </div>
          <div>
            Teslim: {result.delivery.processed} iş işlendi, {result.delivery.sent} gönderildi, {result.delivery.notConfigured} yapılandırılmadı,{" "}
            {result.delivery.retryScheduled} yeniden denemeye alındı, {result.delivery.dead} kalıcı başarısız.
          </div>
        </div>
      ) : null}
    </div>
  );
}
