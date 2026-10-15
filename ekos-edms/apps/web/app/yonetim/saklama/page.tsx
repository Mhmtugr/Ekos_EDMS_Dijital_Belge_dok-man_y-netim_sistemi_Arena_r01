// Saklama profilleri (R-RET-01): liste, oluşturma, hukuki doğrulama. Politika eksiği görünür; süre uydurulmaz.
import { authorize } from "@ekos/core";
import { listFiscalYearEnds, listRetentionProfiles } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { requireActor } from "../session-guard";
import { ProfileForms } from "./ProfileForms";
import { FiscalYearForm } from "./FiscalForms";

const TH = { textAlign: "left" as const, borderBottom: "1px solid #ccc" };

export default async function SaklamaPage(): Promise<React.JSX.Element> {
  const actor = await requireActor();
  const now = new Date();
  const canConfig = authorize({ actor, permission: "config.manage", now }).allowed;
  const canLegal = authorize({ actor, permission: "contract.legal_review", now }).allowed;
  if (!canConfig && !canLegal) {
    return (
      <section>
        <h1>Saklama profilleri</h1>
        <p role="alert">Bu ekran için yetkiniz yok.</p>
      </section>
    );
  }
  const rows = await listRetentionProfiles(db(), { actor, now });
  const fiscal = canConfig ? await listFiscalYearEnds(db(), { actor, now }) : [];
  return (
    <section>
      <h1>Saklama profilleri</h1>
      <p>
        Süreler kurum politikasından girilir; sistem varsayılan süre tanımlamaz. Hukuken doğrulanmamış veya eksik profil ile
        belge imha edilemez (politika eksiği).
      </p>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.9rem" }}>
        <thead>
          <tr>
            <th style={TH}>Kod</th>
            <th style={TH}>Başlangıç</th>
            <th style={TH}>Süre</th>
            <th style={TH}>Yöntem</th>
            <th style={TH}>Onaycı sayısı</th>
            <th style={TH}>Durum</th>
            <th style={TH}>Satır sürümü</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td>{p.code}</td>
              <td>{p.startEvent ?? "politika bekliyor"}</td>
              <td>{p.durationValue !== null && p.durationUnit ? `${String(p.durationValue)} ${p.durationUnit}` : "politika bekliyor"}</td>
              <td>{p.disposalMethod ?? "—"}</td>
              <td>{String(p.disposalApproverCount)}</td>
              <td>{p.verifiedByLegal ? "Hukuken doğrulandı" : "Doğrulanmadı (imha edilemez)"}</td>
              <td>{p.rowVersion}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {canConfig && (
        <>
          <h2 style={{ fontSize: "1rem", marginTop: "1.5rem" }}>Mali yıl sonu takvimi</h2>
          <p style={{ fontSize: "0.9rem" }}>
            Mali yıl sonu olayı (FISCAL_YEAR_END) yalnızca burada girilen tarihle çözülür. Girilmeyen yıl için başlangıç tarihi
            hesaplanmaz ve belge imhaya uygun olmaz.
          </p>
          <table style={{ borderCollapse: "collapse", fontSize: "0.9rem", marginBottom: "0.75rem" }}>
            <thead>
              <tr>
                <th style={TH}>Yıl</th>
                <th style={TH}>Mali yıl sonu</th>
                <th style={TH}>Sürüm</th>
              </tr>
            </thead>
            <tbody>
              {fiscal.length === 0 && (
                <tr>
                  <td colSpan={3}>Tanımlı mali yıl sonu yok.</td>
                </tr>
              )}
              {fiscal.map((f) => (
                <tr key={f.year}>
                  <td>{f.year}</td>
                  <td>{f.endDate}</td>
                  <td>{f.rowVersion}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <FiscalYearForm />
          <h2 style={{ fontSize: "1rem", marginTop: "1.5rem" }}>Yeni profil</h2>
          <ProfileForms mode="create" />
        </>
      )}
      {canLegal && (
        <>
          <h2 style={{ fontSize: "1rem", marginTop: "1.5rem" }}>Hukuki doğrulama</h2>
          <ProfileForms mode="verify" profiles={rows.map((r) => ({ id: r.id, code: r.code, rowVersion: r.rowVersion }))} />
        </>
      )}
    </section>
  );
}
