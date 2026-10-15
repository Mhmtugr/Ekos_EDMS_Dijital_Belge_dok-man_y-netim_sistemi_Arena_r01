"use client";

// Vekalet oluşturma formu. Gerekçe zorunlu; süre en fazla 90 gün; vekil aktif kullanıcılardan seçilir.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formText } from "@/lib/form-text";

interface Candidate {
  id: string;
  displayName: string;
}

export function DelegationForm(): React.JSX.Element {
  const router = useRouter();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/delegations?candidates=1")
      .then((r) => r.json() as Promise<{ items?: Candidate[] }>)
      .then((j) => { setCandidates(j.items ?? []); })
      .catch(() => { setCandidates([]); });
  }, []);

  async function submit(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = {
      delegateId: formText(fd.get("delegateId")),
      startsAt: formText(fd.get("startsAt")),
      endsAt: formText(fd.get("endsAt")),
      reason: formText(fd.get("reason")),
    };
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/delegations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { detail?: string; code?: string };
      if (res.ok) {
        setMessage({ kind: "ok", text: "Vekalet oluşturuldu." });
        e.currentTarget.reset();
        router.refresh();
      } else {
        setMessage({ kind: "err", text: data.detail ?? `İşlem başarısız (${data.code ?? String(res.status)})` });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} aria-labelledby="vekalet-form-baslik" style={{ display: "grid", gap: "0.6rem", maxWidth: 520 }}>
      <h2 id="vekalet-form-baslik" style={{ fontSize: "1.05rem", margin: 0 }}>
        Yeni vekalet
      </h2>
      <label style={{ display: "flex", flexDirection: "column" }}>
        Vekil
        <select name="delegateId" required defaultValue="" style={{ padding: "0.4rem" }}>
          <option value="" disabled>
            Seçiniz
          </option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayName}
            </option>
          ))}
        </select>
      </label>
      <label style={{ display: "flex", flexDirection: "column" }}>
        Başlangıç
        <input type="date" name="startsAt" required style={{ padding: "0.4rem" }} />
      </label>
      <label style={{ display: "flex", flexDirection: "column" }}>
        Bitiş (en fazla 90 gün)
        <input type="date" name="endsAt" required style={{ padding: "0.4rem" }} />
      </label>
      <label style={{ display: "flex", flexDirection: "column" }}>
        Gerekçe (zorunlu)
        <textarea name="reason" required maxLength={500} rows={2} style={{ padding: "0.4rem" }} />
      </label>
      <div>
        <button type="submit" disabled={busy} style={{ padding: "0.45rem 1rem" }}>
          {busy ? "Kaydediliyor…" : "Vekalet ver"}
        </button>
      </div>
      {message ? (
        <p role={message.kind === "err" ? "alert" : "status"} style={{ color: message.kind === "err" ? "#9a1c1c" : "#1a7f37" }}>
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
