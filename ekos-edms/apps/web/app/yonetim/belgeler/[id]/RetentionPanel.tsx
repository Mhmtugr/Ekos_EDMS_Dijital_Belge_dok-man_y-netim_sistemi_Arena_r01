"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi, field, messageOf } from "../../gov-client";

export interface HoldView {
  id: string;
  reason: string;
  placedAt: string;
  releasedAt: string | null;
  scopeNote: string | null;
}

interface Props {
  readonly docId: string;
  readonly docRowVersion: number;
  readonly canHold: boolean;
  readonly canRetention: boolean;
  readonly holds: HoldView[];
  readonly profiles: { id: string; code: string }[];
  readonly currentProfileId: string | null;
}

export function RetentionPanel(p: Props): React.JSX.Element {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const active = p.holds.filter((h) => h.releasedAt === null);

  async function call(method: "POST", url: string, body: unknown, ok: string): Promise<boolean> {
    const r = await callApi(method, url, body);
    setMsg(messageOf(r, ok));
    if (r.ok || r.status === 409) router.refresh();
    return r.ok;
  }

  return (
    <div style={{ marginTop: "2rem", borderTop: "1px solid #d0d7de", paddingTop: "1rem" }}>
      <h2 style={{ fontSize: "1.1rem" }}>Saklama ve hukuki bekletme</h2>
      <p style={{ fontSize: "0.9rem", color: "#57606a" }}>
        Aktif bekletme varken belge imha edilemez ve kalıcı silinemez. Her bekletme ve kaldırma denetim kaydına yazılır.
      </p>

      <h3 style={{ fontSize: "1rem" }}>Bekletmeler</h3>
      {p.holds.length === 0 && <p>Bekletme kaydı yok.</p>}
      <ul>
        {p.holds.map((h) => (
          <li key={h.id} style={{ marginBottom: "0.5rem" }}>
            <strong>{h.releasedAt ? "Kaldırıldı" : "AKTİF"}</strong> · {h.placedAt.slice(0, 16).replace("T", " ")} · {h.reason}
            {h.scopeNote ? ` (kapsam: ${h.scopeNote})` : ""}
            {h.releasedAt === null && p.canHold && (
              <HoldRelease holdId={h.id} onDone={(ok) => { if (ok) router.refresh(); }} />
            )}
          </li>
        ))}
      </ul>
      {p.canHold && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const fd = new FormData(form);
            void call(
              "POST",
              `/api/documents/${p.docId}/legal-holds`,
              { reason: field(fd, "reason").trim(), scopeNote: field(fd, "scopeNote").trim() || null },
              "Bekletme eklendi.",
            ).then((ok) => { if (ok) form.reset(); });
          }}
          style={{ display: "grid", gap: "0.4rem", maxWidth: 520 }}
        >
          <textarea name="reason" required maxLength={2000} placeholder="Bekletme gerekçesi (zorunlu)" />
          <input name="scopeNote" maxLength={2000} placeholder="Kapsam notu (isteğe bağlı)" />
          <button type="submit">Bekletme koy</button>
        </form>
      )}
      {active.length > 0 && <p style={{ fontSize: "0.85rem" }}>Aktif bekletme sayısı: {active.length}</p>}

      {p.canRetention && (
        <>
          <h3 style={{ fontSize: "1rem", marginTop: "1.5rem" }}>Saklama profili ataması</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const v = (e.currentTarget.elements.namedItem("profileId") as HTMLSelectElement).value;
              void call(
                "POST",
                `/api/documents/${p.docId}/retention`,
                { profileId: v === "" ? null : v, expectedRowVersion: p.docRowVersion },
                "Saklama profili güncellendi.",
              );
            }}
            style={{ display: "flex", gap: "0.5rem" }}
          >
            <select name="profileId" defaultValue={p.currentProfileId ?? ""}>
              <option value="">Profil yok (politika eksiği)</option>
              {p.profiles.map((x) => (
                <option key={x.id} value={x.id}>{x.code}</option>
              ))}
            </select>
            <button type="submit">Ata</button>
          </form>
          <h3 style={{ fontSize: "1rem", marginTop: "1.5rem" }}>Saklama başlangıç olayı kaydet</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              void call(
                "POST",
                `/api/documents/${p.docId}/trigger-events`,
                { eventDate: field(fd, "eventDate"), note: field(fd, "note").trim() },
                "Olay kaydedildi.",
              );
            }}
            style={{ display: "grid", gap: "0.4rem", maxWidth: 520 }}
          >
            <input name="eventDate" type="date" required />
            <input name="note" required maxLength={2000} placeholder="Olay notu (ör. sözleşme sona erdi)" />
            <button type="submit">Olayı kaydet</button>
          </form>
        </>
      )}
      {msg && <p role="status">{msg}</p>}
    </div>
  );
}

function HoldRelease({ holdId, onDone }: { holdId: string; onDone: (ok: boolean) => void }): React.JSX.Element {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      style={{ display: "inline-flex", gap: "0.3rem", marginLeft: "0.5rem" }}
      onSubmit={(e) => {
        e.preventDefault();
        const reason = field(new FormData(e.currentTarget), "reason").trim();
        void callApi("POST", `/api/legal-holds/${holdId}/release`, { reason }).then((r) => {
          setMsg(messageOf(r, "Bekletme kaldırıldı."));
          onDone(r.ok);
        });
      }}
    >
      <input name="reason" required maxLength={2000} placeholder="Kaldırma gerekçesi" />
      <button type="submit">Kaldır</button>
      {msg && <span role="status">{msg}</span>}
    </form>
  );
}
