// Raporlar: yetkiye göre kullanılabilir rapor türleri. Üretim ve audit servis katmanındadır.
import { authorize } from "@ekos/core";
import { hasAnyGrant } from "@ekos/db";
import { requireActor } from "../session-guard";
import { ReportForm } from "./ReportForm";

export default async function RaporlarPage(): Promise<React.JSX.Element> {
  const actor = await requireActor();
  const now = new Date();
  const canDocs = hasAnyGrant(actor, "document.list", now);
  const canApprove = hasAnyGrant(actor, "document.approve", now);
  const canAudit = authorize({ actor, permission: "audit.export", now }).allowed;
  if (!canDocs && !canApprove && !canAudit) {
    return (
      <section>
        <h1>Raporlar</h1>
        <p role="alert">Rapor üretmek için yetkiniz yok.</p>
      </section>
    );
  }
  const allowed: string[] = [];
  if (canDocs) allowed.push("CONTRACT_PORTFOLIO", "CONTRACT_DEADLINES", "OBLIGATIONS_OPEN");
  if (canApprove) allowed.push("APPROVALS_OPEN");
  if (canAudit) allowed.push("AUDIT_EXTRACT");
  return (
    <section>
      <h1>Raporlar</h1>
      <p style={{ color: "#57606a" }}>Her dışa aktarma kim, ne zaman, hangi kapsamla yaptığını denetim kaydına yazar.</p>
      <ReportForm allowed={allowed} />
      <p style={{ marginTop: "1rem", fontSize: "0.85rem", color: "#57606a" }}>
        Kullanılabilir türler yetkinize göre gösterilir. PDF çıktısı bu sürümde yoktur (yalnız CSV ve XLSX).
      </p>
    </section>
  );
}
