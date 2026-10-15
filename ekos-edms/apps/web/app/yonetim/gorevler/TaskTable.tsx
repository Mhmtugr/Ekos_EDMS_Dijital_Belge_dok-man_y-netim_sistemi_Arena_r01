"use client";

// Bekleyen onay görevleri: tekil karar (onayla / geri gönder / reddet, gerekçeli) ve toplu onay.
// Her karar ayrı bir istektir; toplu işlemde sonuçlar satır satır raporlanır (kısmi başarı açıkça gösterilir).
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export interface TaskView {
  id: string;
  subjectTitle: string;
  subjectHref: string | null;
  dueAt: string | null;
  sla: string;
  viaDelegation: boolean;
}

const SLA_LABEL: Record<string, string> = { NO_SLA: "Süre yok", ON_TIME: "Zamanında", DUE_SOON: "Yakında (48 saat)", OVERDUE: "Gecikmiş" };
const SLA_COLOR: Record<string, string> = { NO_SLA: "#57606a", ON_TIME: "#1a7f37", DUE_SOON: "#9a6700", OVERDUE: "#9a1c1c" };
const TH = { textAlign: "left" as const, borderBottom: "1px solid #ccc", padding: "0.4rem" };
const TD = { padding: "0.4rem", borderBottom: "1px solid #eee", verticalAlign: "top" as const };
const BTN = { padding: "0.25rem 0.6rem" } as const;

type Kind = "APPROVE" | "RETURN" | "REJECT";
const KIND_LABEL: Record<Kind, string> = { APPROVE: "Onayla", RETURN: "Geri gönder", REJECT: "Reddet" };

async function decide(id: string, decision: Kind, reason: string | null): Promise<{ ok: boolean; text: string }> {
  const res = await fetch(`/api/approval-tasks/${id}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, reason }),
  });
  if (res.ok) return { ok: true, text: "Karar kaydedildi" };
  const d = (await res.json().catch(() => ({}))) as { detail?: string; message?: string; code?: string };
  return { ok: false, text: d.detail ?? d.message ?? `Başarısız (${d.code ?? String(res.status)})` };
}

export function TaskTable({ tasks, canDecide }: { tasks: readonly TaskView[]; canDecide: boolean }): React.JSX.Element {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<{ id: string; kind: Kind } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string; details?: string[] } | null>(null);

  const toggle = (id: string): void => { setSelected((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    }); };

  async function single(id: string, kind: Kind): Promise<void> {
    if (kind !== "APPROVE" && reason.trim().length === 0) {
      setMsg({ kind: "err", text: "Geri gönderme ve reddetmede gerekçe zorunludur." });
      return;
    }
    setBusy(true);
    setMsg(null);
    const r = await decide(id, kind, kind === "APPROVE" ? null : reason.trim()).catch(() => ({ ok: false, text: "Sunucuya ulaşılamadı." }));
    setBusy(false);
    setMsg({ kind: r.ok ? "ok" : "err", text: r.ok ? `${KIND_LABEL[kind]}: ${r.text}.` : r.text });
    if (r.ok) {
      setOpen(null);
      setReason("");
      setSelected(new Set());
      router.refresh();
    }
  }

  async function bulkApprove(): Promise<void> {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBusy(true);
    setMsg(null);
    const details: string[] = [];
    let okCount = 0;
    for (const id of ids) {
      const t = tasks.find((x) => x.id === id);
      const r = await decide(id, "APPROVE", null).catch(() => ({ ok: false, text: "Sunucuya ulaşılamadı." }));
      if (r.ok) okCount += 1;
      details.push(`${t?.subjectTitle ?? id}: ${r.ok ? "onaylandı" : r.text}`);
    }
    setBusy(false);
    setMsg({
      kind: okCount === ids.length ? "ok" : "err",
      text: `${String(okCount)} / ${String(ids.length)} görev onaylandı.`,
      details,
    });
    setSelected(new Set());
    router.refresh();
  }

  if (tasks.length === 0) {
    return (
      <div>
        <p role="status" style={{ border: "1px dashed #8c959f", padding: "1rem", borderRadius: 8 }}>
          Veri yok. Bekleyen onay göreviniz bulunmuyor.
        </p>
      {msg ? (
          <div role={msg.kind === "err" ? "alert" : "status"} style={{ marginTop: "0.5rem", color: msg.kind === "err" ? "#9a1c1c" : "#1a7f37" }}>
            <p style={{ margin: 0 }}>{msg.text}</p>
            {msg.details ? (
              <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1.25rem", color: "#24292f" }}>
                {msg.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      {canDecide ? (
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", margin: "0.5rem 0", flexWrap: "wrap" }}>
          <button type="button" onClick={() => void bulkApprove()} disabled={busy || selected.size === 0} style={BTN}>
            Seçilenleri onayla ({selected.size})
          </button>
          <span style={{ color: "#57606a", fontSize: "0.85rem" }}>Toplu işlemde gerekçe gerekmez; geri gönderme ve reddetme tek tek yapılır.</span>
        </div>
      ) : (
        <p style={{ color: "#57606a" }}>Bu görevlerde karar verme yetkiniz yok; yalnız görüntüleyebilirsiniz.</p>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.9rem" }}>
          <caption style={{ textAlign: "left", padding: "0.5rem 0" }}>Bekleyen onay görevleri</caption>
          <thead>
            <tr>
              {canDecide ? (
                <th scope="col" style={TH}>
                  Seç
                </th>
              ) : null}
              <th scope="col" style={TH}>Konu</th>
              <th scope="col" style={TH}>Son tarih</th>
              <th scope="col" style={TH}>Süre durumu</th>
              <th scope="col" style={TH}>Kaynak</th>
              {canDecide ? (
                <th scope="col" style={TH}>
                  Karar
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                {canDecide ? (
                  <td style={TD}>
                    <input type="checkbox" checked={selected.has(t.id)} onChange={() => { toggle(t.id); }} aria-label={`${t.subjectTitle} görevini seç`} />
                  </td>
                ) : null}
                <td style={TD}>{t.subjectHref ? <Link href={t.subjectHref}>{t.subjectTitle}</Link> : t.subjectTitle}</td>
                <td style={TD}>{t.dueAt ? new Date(t.dueAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }) : "Belirsiz"}</td>
                <td style={{ ...TD, color: SLA_COLOR[t.sla], fontWeight: 600 }}>{SLA_LABEL[t.sla] ?? t.sla}</td>
                <td style={TD}>{t.viaDelegation ? "Vekaletle devralındı" : "Bana atandı"}</td>
                {canDecide ? (
                  <td style={TD}>
                    <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                      <button type="button" disabled={busy} onClick={() => void single(t.id, "APPROVE")} aria-label={`${t.subjectTitle} görevini onayla`} style={BTN}>
                        Onayla
                      </button>
                      <button type="button" disabled={busy} onClick={() => { setOpen({ id: t.id, kind: "RETURN" }); setReason(""); }} aria-label={`${t.subjectTitle} görevini geri gönder`} style={BTN}>
                        Geri gönder
                      </button>
                      <button type="button" disabled={busy} onClick={() => { setOpen({ id: t.id, kind: "REJECT" }); setReason(""); }} aria-label={`${t.subjectTitle} görevini reddet`} style={BTN}>
                        Reddet
                      </button>
                    </div>
                    {open?.id === t.id ? (
                      <div style={{ marginTop: "0.5rem", display: "grid", gap: "0.35rem" }}>
                        <label>
                          Gerekçe ({open.kind === "REJECT" ? "reddetme" : "geri gönderme"}, zorunlu)
                          <textarea value={reason} onChange={(e) => { setReason(e.target.value); }} rows={2} maxLength={2000} style={{ display: "block", width: "100%", padding: "0.3rem" }} />
                        </label>
                        <div style={{ display: "flex", gap: "0.35rem" }}>
                          <button type="button" disabled={busy} onClick={() => void single(t.id, open.kind)} style={BTN}>
                            {KIND_LABEL[open.kind]} (onayla)
                          </button>
                          <button type="button" onClick={() => { setOpen(null); }} style={BTN}>
                            Vazgeç
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {msg ? (
        <div role={msg.kind === "err" ? "alert" : "status"} style={{ marginTop: "0.5rem", color: msg.kind === "err" ? "#9a1c1c" : "#1a7f37" }}>
          <p style={{ margin: 0 }}>{msg.text}</p>
          {msg.details ? (
            <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1.25rem", color: "#24292f" }}>
              {msg.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
