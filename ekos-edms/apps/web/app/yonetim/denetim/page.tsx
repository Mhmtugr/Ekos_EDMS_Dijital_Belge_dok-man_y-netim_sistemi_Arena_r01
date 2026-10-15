// Denetim ekranı: filtreli audit olayları ve kanıt paketi dışa aktarımı. Yetki: audit.export (ikisi için de).
// Liste API'siyle aynı filtre ve aynı tarih aralığı kuralı (+03:00, en fazla 366 gün) kullanılır.
import { authorize } from "@ekos/core";
import { verifyAuditTable } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { requireActor } from "../session-guard";

const TH = { textAlign: "left" as const, borderBottom: "1px solid #ccc" };
const OUTCOMES = ["SUCCESS", "DENIED", "FAILED"] as const;
const ACTOR_TYPES = ["USER", "SYSTEM", "WORKER", "BREAK_GLASS"] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function todayIst(): string {
  return new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
}
function daysAgoIst(n: number): string {
  return new Date(Date.now() + 3 * 3600_000 - n * 86_400_000).toISOString().slice(0, 10);
}

export default async function DenetimPage(props: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<React.JSX.Element> {
  const actor = await requireActor();
  const now = new Date();
  if (!authorize({ actor, permission: "audit.export", now }).allowed) {
    return (
      <section>
        <h1>Denetim</h1>
        <p role="alert">Bu ekran için yetkiniz yok.</p>
      </section>
    );
  }
  const q = await props.searchParams;
  const from = q.from && DATE_RE.test(q.from) ? q.from : daysAgoIst(7);
  const to = q.to && DATE_RE.test(q.to) ? q.to : todayIst();
  const fromDate = new Date(`${from}T00:00:00+03:00`);
  const toDate = new Date(`${to}T23:59:59.999+03:00`);
  const rangeOk = !Number.isNaN(fromDate.getTime()) && !Number.isNaN(toDate.getTime()) && fromDate <= toDate && (toDate.getTime() - fromDate.getTime()) / 86_400_000 <= 366;
  const eventType = q.eventType?.trim() || undefined;
  const targetType = q.targetType?.trim() || undefined;
  const actorId = q.actorId && UUID_RE.test(q.actorId) ? q.actorId : undefined;
  const outcome = (OUTCOMES as readonly string[]).includes(q.outcome ?? "") ? (q.outcome as (typeof OUTCOMES)[number]) : undefined;
  const actorType = (ACTOR_TYPES as readonly string[]).includes(q.actorType ?? "") ? (q.actorType as (typeof ACTOR_TYPES)[number]) : undefined;

  const rows = rangeOk
    ? await db().auditEvent.findMany({
        where: {
          occurredAt: { gte: fromDate, lte: toDate },
          ...(eventType ? { eventType } : {}),
          ...(actorId ? { actorId } : {}),
          ...(targetType ? { targetType } : {}),
          ...(outcome ? { outcome } : {}),
          ...(actorType ? { actorType } : {}),
        },
        orderBy: { sequence: "desc" },
        take: 300,
      })
    : [];
  const chain = await verifyAuditTable(db());
  const inputStyle = { padding: "0.25rem" };

  return (
    <section>
      <h1>Denetim</h1>
      <p style={{ fontSize: "0.9rem" }}>
        Zincir bütünlüğü:{" "}
        <strong>{chain.ok ? "Doğrulandı" : "BOZULMUŞ — incelemeye alın"}</strong>
      </p>
      <form method="GET" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "end", margin: "1rem 0" }}>
        <label>Başlangıç<br /><input type="date" name="from" defaultValue={from} style={inputStyle} /></label>
        <label>Bitiş<br /><input type="date" name="to" defaultValue={to} style={inputStyle} /></label>
        <label>Olay türü<br /><input name="eventType" defaultValue={eventType ?? ""} style={inputStyle} /></label>
        <label>Hedef türü<br /><input name="targetType" defaultValue={targetType ?? ""} style={inputStyle} /></label>
        <label>Kullanıcı kimliği<br /><input name="actorId" defaultValue={actorId ?? ""} style={{ ...inputStyle, minWidth: 260 }} /></label>
        <label>Sonuç<br />
          <select name="outcome" defaultValue={outcome ?? ""} style={inputStyle}>
            <option value="">Tümü</option>
            {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label>Aktör türü<br />
          <select name="actorType" defaultValue={actorType ?? ""} style={inputStyle}>
            <option value="">Tümü</option>
            {ACTOR_TYPES.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <button type="submit" style={inputStyle}>Filtrele</button>
      </form>
      {!rangeOk && <p role="alert">Tarih aralığı geçersiz (en fazla 366 gün).</p>}

      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.85rem" }}>
        <thead>
          <tr>
            <th style={TH}>Sıra</th>
            <th style={TH}>Zaman (UTC)</th>
            <th style={TH}>Olay</th>
            <th style={TH}>Aktör</th>
            <th style={TH}>Hedef</th>
            <th style={TH}>Sonuç</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={6}>Filtreye uyan olay yok.</td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.sequence.toString()}>
              <td>{r.sequence.toString()}</td>
              <td>{r.occurredAt.toISOString().slice(0, 19).replace("T", " ")}</td>
              <td><code>{r.eventType}</code></td>
              <td>{r.actorType}{r.actorId ? ` · ${r.actorId.slice(0, 8)}…` : ""}</td>
              <td>{r.targetType}{r.targetId ? ` · ${r.targetId.slice(0, 8)}…` : ""}</td>
              <td>{r.outcome}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ fontSize: "1rem", marginTop: "2rem" }}>Kanıt paketi dışa aktarımı</h2>
      <p style={{ fontSize: "0.9rem" }}>
        Paket yalnızca yetkinizin kapsadığı kayıtları içerir; her dışa aktarım denetim kaydına yazılır. Yetki sınırı servis katmanında
        uygulanır.
      </p>
      <form method="GET" action="/api/audit/evidence-pack" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "end" }}>
        <label>Başlangıç<br /><input type="date" name="from" defaultValue={from} required style={inputStyle} /></label>
        <label>Bitiş<br /><input type="date" name="to" defaultValue={to} required style={inputStyle} /></label>
        <label>Birim kimliği (ops.)<br /><input name="departmentId" style={{ ...inputStyle, minWidth: 260 }} /></label>
        <label>Belge kimliği (ops.)<br /><input name="documentId" style={{ ...inputStyle, minWidth: 260 }} /></label>
        <button type="submit" style={inputStyle}>Kanıt paketini indir (JSON)</button>
      </form>
    </section>
  );
}
