// Karşı taraf yönetimi (minimal): liste ve oluşturma. Yetki yoksa içerik gösterilmez.
import { authorize } from "@ekos/core";
import { db } from "@/lib/server/runtime";
import { listActiveCounterparties } from "@ekos/db";
import { requireActor } from "../session-guard";
import { CounterpartyForm } from "./CounterpartyForm";

export default async function KarsiTaraflarPage(): Promise<React.JSX.Element> {
  const actor = await requireActor();
  if (!authorize({ actor, permission: "counterparty.manage", now: new Date() }).allowed) {
    return (
      <section>
        <h1>Karşı taraflar</h1>
        <p role="alert">Bu ekran için yetkiniz yok.</p>
      </section>
    );
  }
  const rows = await listActiveCounterparties(db());
  return (
    <section>
      <h1>Karşı taraflar</h1>
      <p>Belge yüklerken seçilir. Tür bazında zorunlu olabilir (ör. satınalma siparişi).</p>
      <h2 style={{ fontSize: "1rem" }}>Yeni karşı taraf</h2>
      <CounterpartyForm />
      <h2 style={{ fontSize: "1rem", marginTop: "1.5rem" }}>Aktif kayıtlar ({rows.length})</h2>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Resmi ad</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Ülke</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={{ padding: "0.3rem 0" }}>{r.officialName}</td>
              <td>{r.countryCode}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
