"use client";

// Vekalet iptali. Eşzamanlılık için rowVersion gönderilir; çakışmada sunucu 409 döner.
import { useState } from "react";
import { useRouter } from "next/navigation";

export function RevokeButton({ id, rowVersion, label }: { id: string; rowVersion: number; label: string }): React.JSX.Element {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setErr(null);
          void fetch(`/api/delegations/${id}/revoke`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ expectedRowVersion: rowVersion }),
          }).then(async (res) => {
            if (res.ok) router.refresh();
            else {
              const d = (await res.json().catch(() => ({}))) as { detail?: string; code?: string };
              setErr(d.detail ?? `İptal edilemedi (${d.code ?? String(res.status)})`);
            }
          });
        }}
        aria-label={`${label} vekaletini iptal et`}
        style={{ padding: "0.25rem 0.6rem" }}
      >
        İptal et
      </button>
      {err ? (
        <span role="alert" style={{ color: "#9a1c1c", marginLeft: "0.5rem" }}>
          {err}
        </span>
      ) : null}
    </>
  );
}
