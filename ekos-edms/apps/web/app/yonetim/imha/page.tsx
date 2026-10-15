// İmha inceleme kuyruğu (R-DISP). Yalnızca görülebilen belgeler listelenir. Karar: inceleyen → ikinci ve farklı onaycı.
import { authorize } from "@ekos/core";
import { listDispositionQueue, listExecutedDispositions } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { requireActor } from "../session-guard";
import { DispositionForms, SystemJobs } from "./DispositionForms";

const TH = { textAlign: "left" as const, borderBottom: "1px solid #ccc" };
const STATUS_LABEL: Record<string, string> = {
  PENDING_REVIEW: "İnceleme bekliyor",
  BLOCKED: "Engelli (imha yapılamaz)",
  APPROVED: "Onaylandı (yürütme bekliyor)",
};

export default async function ImhaPage(): Promise<React.JSX.Element> {
  const actor = await requireActor();
  const now = new Date();
  const items = await listDispositionQueue(db(), { actor, now });
  const canSystem = authorize({ actor, permission: "config.manage", now }).allowed;
  const executed = canSystem ? await listExecutedDispositions(db(), { actor, now }) : [];
  return (
    <section>
      <h1>İmha kuyruğu</h1>
      <p>
        Süresi dolan belgeler otomatik silinmez; önce inceleme, sonra farklı bir ikinci onaycı gerekir. Hukuki bekletmesi olan
        veya engeli bulunan belge onaylanamaz.
      </p>
      {canSystem && <SystemJobs />}
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.9rem", marginTop: "1rem" }}>
        <thead>
          <tr>
            <th style={TH}>Belge</th>
            <th style={TH}>Durum</th>
            <th style={TH}>Engel</th>
            <th style={TH}>Vade</th>
            <th style={TH}>Karar</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr>
              <td colSpan={5}>Kuyrukta belge yok.</td>
            </tr>
          )}
          {items.map((i) => (
            <tr key={i.reviewId}>
              <td>{i.number}</td>
              <td>{STATUS_LABEL[i.status] ?? i.status}</td>
              <td>{i.blockedReason ?? "—"}</td>
              <td>{i.retentionDueAt ? i.retentionDueAt.toISOString().slice(0, 10) : "politika bekliyor"}</td>
              <td>
                {i.status !== "BLOCKED" ? <DispositionForms reviewId={i.reviewId} status={i.status} rowVersion={i.rowVersion} /> : "Engel kalkana kadar karar verilemez"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {canSystem && (
        <>
          <h2 style={{ fontSize: "1rem", marginTop: "2rem" }}>Yürütülen imhalar</h2>
          <p style={{ fontSize: "0.9rem" }}>
            Yürütülen imha yalnızca içeriksiz manifest ile kayıt altına alınır. Tutanak, manifest bütünlüğü doğrulandıktan sonra
            üretilir. Fiziksel imha için kanıt referansı tutanakta ayrıca yer alır.
          </p>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.9rem" }}>
            <thead>
              <tr>
                <th style={TH}>Belge numarası</th>
                <th style={TH}>Yürütme (UTC)</th>
                <th style={TH}>Fiziksel kanıt ref.</th>
                <th style={TH}>Manifest SHA-256</th>
                <th style={TH}>Tutanak</th>
              </tr>
            </thead>
            <tbody>
              {executed.length === 0 && (
                <tr>
                  <td colSpan={5}>Yürütülmüş imha yok.</td>
                </tr>
              )}
              {executed.map((x) => (
                <tr key={x.reviewId}>
                  <td>{x.documentNumber ?? "—"}</td>
                  <td>{x.executedAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                  <td>{x.physicalEvidenceRef ?? "—"}</td>
                  <td>
                    <code style={{ fontSize: "0.75rem" }}>{x.manifestSha256.slice(0, 16)}…</code>
                  </td>
                  <td>
                    <a href={`/api/disposal/reviews/${x.reviewId}/certificate`}>PDF indir</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
