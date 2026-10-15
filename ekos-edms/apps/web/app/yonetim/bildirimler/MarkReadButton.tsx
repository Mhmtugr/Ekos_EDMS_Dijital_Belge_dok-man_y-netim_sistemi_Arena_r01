"use client";

// Bildirimi okundu işaretle. Sunucu yanıtı başarısızsa hata metni (role=alert) gösterilir.
import { useState } from "react";
import { useRouter } from "next/navigation";

export function MarkReadButton({ id, title }: { id: string; title: string }): React.JSX.Element {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button
        type="button"
        disabled={busy}
        aria-label={`"${title}" bildirimini okundu olarak işaretle`}
        onClick={() => {
          setBusy(true);
          setErr(null);
          void fetch(`/api/notifications/${id}/read`, { method: "POST" })
            .then((res) => {
              if (res.ok) router.refresh();
              else setErr(`İşaretlenemedi (${String(res.status)})`);
            })
            .catch(() => { setErr("Bağlantı hatası"); })
            .finally(() => { setBusy(false); });
        }}
        style={{ padding: "0.25rem 0.6rem" }}
      >
        Okundu işaretle
      </button>
      {err ? (
        <span role="alert" style={{ color: "#9a1c1c", marginLeft: "0.5rem" }}>
          {err}
        </span>
      ) : null}
    </>
  );
}
