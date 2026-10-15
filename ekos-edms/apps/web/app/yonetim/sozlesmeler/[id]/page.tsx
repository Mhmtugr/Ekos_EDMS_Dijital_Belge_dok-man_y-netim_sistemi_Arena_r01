// Sözleşme detayı: yükümlülükler, teminatlar, onay akışı. Görünürlük dışı kayıt 404 döner.
import Link from "next/link";
import { notFound } from "next/navigation";
import { DomainError, getContractDetail } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { isUuid } from "@/lib/server/request";
import { requireActor } from "../../session-guard";
import { hasActiveGrant } from "@/lib/server/grants";
import { ContractFieldsForm, type ContractFieldValues } from "./ContractFieldsForm";
import { WorkflowStart } from "./WorkflowStart";
import { SignatureForm } from "./SignatureForm";

const d = (v: Date | null | undefined): string => (v ? v.toISOString().slice(0, 10) : "—");
const TH = { textAlign: "left" as const, borderBottom: "1px solid #ccc", padding: "0.4rem" };
const TD = { padding: "0.4rem", borderBottom: "1px solid #eee" };

const SCAN_LABEL: Record<string, string> = {
  NOT_CONFIGURED: "Tarama yapılandırılmadı",
  UNAVAILABLE: "Tarama servisi kullanılamıyor",
  ERROR: "Tarama hatası",
  PENDING: "Tarama bekleniyor",
  INFECTED: "Bulaşma tespit edildi (karantina)",
};

export default async function SozlesmeDetayPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ tarama?: string }> }): Promise<React.JSX.Element> {
  const actor = await requireActor();
  const { id } = await props.params;
  const { tarama } = await props.searchParams;
  if (!isUuid(id)) notFound();
  let detail;
  try {
    detail = await getContractDetail(db(), { actor, now: new Date(), contractId: id });
  } catch (e) {
    if (e instanceof DomainError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const { contract: c, workflow } = detail;
  const status = c.document.contractStatus ?? "";
  const editable = (status === "DRAFT" || status === "IN_REVIEW") && hasActiveGrant(actor, ["contract.create"]);
  // Bileşenler durum değişince (başlatma/imza) de bağlı kalır; böylece başarı mesajı kaybolmaz.
  const canStart = (status === "DRAFT" || status === "IN_REVIEW" || status === "PENDING_APPROVAL") && hasActiveGrant(actor, ["document.start_workflow"]);
  const canSign = (status === "READY_FOR_SIGNATURE" || status === "PENDING_SIGNATURE" || status === "ACTIVE") && hasActiveGrant(actor, ["contract.record_signature"]);
  const iso = (v: Date | null | undefined): string => (v ? v.toISOString().slice(0, 10) : "");
  const values: ContractFieldValues = {
    startDate: iso(c.startDate),
    endDate: iso(c.endDate),
    effectiveDate: iso(c.effectiveDate),
    autoRenewal: c.autoRenewal === null ? "" : c.autoRenewal ? "true" : "false",
    amount: c.amount ? c.amount.toString() : "",
    currency: c.currency ?? "",
    paymentTerms: c.paymentTerms ?? "",
    noticePeriodValue: c.noticePeriodValue === null ? "" : String(c.noticePeriodValue),
    noticePeriodUnit: c.noticePeriodUnit ?? "",
  };
  return (
    <section>
      <p>
        <Link href="/yonetim/sozlesmeler">← Sözleşmeler</Link>
      </p>
      <h1>{c.title}</h1>
      {tarama && tarama !== "CLEAN" ? (
        <p role="status" style={{ border: "1px solid #9a6700", background: "#fff8c5", padding: "0.6rem", borderRadius: 6 }}>
          Sözleşme dosyası yüklendi; tarama durumu: <strong>{SCAN_LABEL[tarama] ?? tarama}</strong>. Dosya taranmadan
          imza kaydedilemez ve sözleşme yürürlüğe girmez.
        </p>
      ) : null}
      <p style={{ color: "#57606a" }}>
        Belge no: {c.document.number} · Karşı taraf: {c.counterparty.officialName} · Tüzel kişi: {c.legalEntity.name}
      </p>
      <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "0.3rem 1rem" }}>
        <dt>Sözleşme türü</dt>
        <dd>{c.contractType}</dd>
        <dt>Başlangıç</dt>
        <dd>{d(c.startDate)}</dd>
        <dt>Bitiş</dt>
        <dd>{d(c.endDate)}</dd>
        <dt>Otomatik yenileme</dt>
        <dd>{c.autoRenewal === null ? "Belirtilmedi" : c.autoRenewal ? "Evet" : "Hayır"}</dd>
        <dt>Tutar</dt>
        <dd>{c.amount ? `${c.amount.toString()} ${c.currency ?? ""}` : "Belirtilmedi"}</dd>
      </dl>

      <p style={{ marginTop: "0.5rem" }}>Durum: <strong>{status || "Belirsiz"}</strong></p>
      {editable ? (
        <div style={{ marginTop: "1.25rem" }}>
          <ContractFieldsForm id={c.id} rowVersion={c.rowVersion} initial={values} />
        </div>
      ) : null}

      <h2 style={{ fontSize: "1.1rem", marginTop: "1.5rem" }}>Onay akışı</h2>
      {canStart ? <WorkflowStart id={c.id} started={workflow !== null} /> : null}
      {!workflow ? (
        <p>Veri yok. Bu sözleşme için onay akışı başlatılmamış.</p>
      ) : (
        <ol>
          {workflow.steps.map((s) => (
            <li key={s.id}>
              Adım {s.orderIndex} ({s.status}): {s.tasks.length === 0 ? "görev yok" : ""}
              <ul>
                {s.tasks.map((t) => (
                  <li key={t.id}>
                    {t.assignee.displayName} — {t.status}
                    {t.decision ? ` (${t.decision.decision}, ${t.decision.decidedAt.toISOString().slice(0, 10)})` : ""}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}

      {canSign ? (
        <div style={{ marginTop: "1.5rem" }}>
          <SignatureForm id={c.id} active={status === "ACTIVE"} />
        </div>
      ) : null}

      <h2 style={{ fontSize: "1.1rem", marginTop: "1.5rem" }}>Yükümlülükler</h2>
      {c.obligations.length === 0 ? (
        <p>Veri yok.</p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th scope="col" style={TH}>Açıklama</th>
              <th scope="col" style={TH}>Vade</th>
              <th scope="col" style={TH}>Durum</th>
            </tr>
          </thead>
          <tbody>
            {c.obligations.map((o) => (
              <tr key={o.id}>
                <td style={TD}>{o.description}</td>
                <td style={TD}>{d(o.dueDate)}</td>
                <td style={TD}>{o.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ fontSize: "1.1rem", marginTop: "1.5rem" }}>Teminatlar</h2>
      {c.guarantees.length === 0 ? (
        <p>Veri yok.</p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th scope="col" style={TH}>Tür</th>
              <th scope="col" style={TH}>Veren</th>
              <th scope="col" style={TH}>Son geçerlilik</th>
              <th scope="col" style={TH}>İade</th>
            </tr>
          </thead>
          <tbody>
            {c.guarantees.map((g) => (
              <tr key={g.id}>
                <td style={TD}>{g.guaranteeType}</td>
                <td style={TD}>{g.issuer}</td>
                <td style={TD}>{d(g.expiresAt)}</td>
                <td style={TD}>{g.returnedAt ? d(g.returnedAt) : "İade edilmedi"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
