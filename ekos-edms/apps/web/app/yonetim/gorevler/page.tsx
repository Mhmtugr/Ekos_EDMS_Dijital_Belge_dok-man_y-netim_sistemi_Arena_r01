// Onaylar / Görevler: bekleyen onay görevlerim (SLA ile), vekaletlerim ve vekalet formu.
import { listDelegations, listMyTasks, type TaskRow } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { requireActor } from "../session-guard";
import { DelegationForm } from "./DelegationForm";
import { RevokeButton } from "./RevokeButton";
import { TaskTable } from "./TaskTable";
import { hasActiveGrant } from "@/lib/server/grants";

const TH = { textAlign: "left" as const, borderBottom: "1px solid #ccc", padding: "0.4rem" };
const TD = { padding: "0.4rem", borderBottom: "1px solid #eee", verticalAlign: "top" as const };

function taskHref(t: TaskRow): string | null {
  return t.subjectType === "CONTRACT" ? `/yonetim/sozlesmeler/${t.subjectId}` : null;
}

export default async function GorevlerPage(): Promise<React.JSX.Element> {
  const actor = await requireActor();
  const now = new Date();
  const [tasks, delegations] = await Promise.all([listMyTasks(db(), { actor, now }), listDelegations(db(), { actor, now })]);
  const canDecide = hasActiveGrant(actor, ["document.approve"], now);
  return (
    <section>
      <h1>Onaylar / Görevler</h1>
      <p style={{ color: "#57606a" }}>Size atanan ve aktif vekaletle devralınan bekleyen onay görevleri. Gecikmiş ve yakın olanlar önce gösterilir.</p>

      <h2 style={{ fontSize: "1.1rem", marginTop: "1.25rem" }}>Bekleyen onaylar</h2>
      <TaskTable
        canDecide={canDecide}
        tasks={tasks.map((t) => ({
          id: t.id,
          subjectTitle: t.subjectTitle,
          subjectHref: taskHref(t),
          dueAt: t.dueAt ? t.dueAt.toISOString() : null,
          sla: t.sla,
          viaDelegation: t.viaDelegationFrom !== null,
        }))}
      />

      <h2 style={{ fontSize: "1.1rem", marginTop: "2rem" }}>Vekaletler</h2>
      {delegations.length === 0 ? (
        <p>Veri yok. Vekalet kaydınız bulunmuyor.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.9rem" }}>
            <caption style={{ textAlign: "left", padding: "0.5rem 0" }}>Verdiğim ve aldığım vekaletler</caption>
            <thead>
              <tr>
                <th scope="col" style={TH}>Veren</th>
                <th scope="col" style={TH}>Vekil</th>
                <th scope="col" style={TH}>Dönem</th>
                <th scope="col" style={TH}>Gerekçe</th>
                <th scope="col" style={TH}>Durum</th>
                <th scope="col" style={TH}>İşlem</th>
              </tr>
            </thead>
            <tbody>
              {delegations.map((v) => (
                <tr key={v.id}>
                  <td style={TD}>{v.delegatorName}</td>
                  <td style={TD}>{v.delegateName}</td>
                  <td style={TD}>
                    {v.startsAt.toISOString().slice(0, 10)} – {v.endsAt.toISOString().slice(0, 10)}
                  </td>
                  <td style={TD}>{v.reason}</td>
                  <td style={TD}>{({ ACTIVE: "Aktif", SCHEDULED: "Planlandı", EXPIRED: "Süresi doldu", REVOKED: "İptal edildi" } as Record<string, string>)[v.state] ?? v.state}</td>
                  <td style={TD}>
                    {v.delegatorId === actor.userId && (v.state === "ACTIVE" || v.state === "SCHEDULED") ? <RevokeButton id={v.id} rowVersion={v.rowVersion} label={v.delegateName} /> : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: "2rem" }}>
        <DelegationForm />
      </div>
    </section>
  );
}
