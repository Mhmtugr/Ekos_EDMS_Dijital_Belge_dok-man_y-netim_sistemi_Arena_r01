// Genel Bakış: YALNIZCA gerçek veritabanı sayımları (getDashboard). Yetkisiz bölümler gizlenir; boş sistemde "veri yok".
import Link from "next/link";
import { getDashboard, type DashboardView } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { requireActor } from "./session-guard";

const SLA_LABEL: Record<string, string> = { NO_SLA: "Süre yok", ON_TIME: "Zamanında", DUE_SOON: "Yakında", OVERDUE: "Gecikmiş" };

function Card({ title, value, href, hint }: { title: string; value: number; href?: string; hint?: string }): React.JSX.Element {
  return (
    <section aria-labelledby={`k-${title}`} style={{ border: "1px solid #d0d7de", borderRadius: 8, padding: "1rem", minWidth: 180 }}>
      <h2 id={`k-${title}`} style={{ fontSize: "0.9rem", margin: 0, color: "#57606a" }}>
        {title}
      </h2>
      <p style={{ fontSize: "1.75rem", fontWeight: 700, margin: "0.4rem 0" }}>{value.toLocaleString("tr-TR")}</p>
      {hint ? <p style={{ fontSize: "0.8rem", margin: 0, color: "#57606a" }}>{hint}</p> : null}
      {href ? (
        <Link href={href} style={{ fontSize: "0.85rem" }}>
          Ayrıntıya git
        </Link>
      ) : null}
    </section>
  );
}

export default async function YonetimGenelPage(): Promise<React.JSX.Element> {
  const actor = await requireActor();
  const now = new Date();
  const d: DashboardView = await getDashboard(db(), { actor, now });
  const c = d.counts;
  const a = d.accessible;
  return (
    <section>
      <h1>Genel Bakış</h1>
      <p style={{ color: "#57606a", fontSize: "0.9rem" }}>
        Gösterilen sayılar veritabanından anlık hesaplanır ve yalnızca yetkinizin gördüğü kayıtları kapsar. Oluşturulma: {d.today} (Europe/Istanbul).
      </p>

      {d.isEmpty ? (
        <p role="status" style={{ border: "1px dashed #8c959f", padding: "1rem", borderRadius: 8 }}>
          Veri yok. Sistemde henüz gösterilecek belge, sözleşme veya görev kaydı bulunmuyor.
        </p>
      ) : null}

      <h2 style={{ fontSize: "1.1rem", marginTop: "1.5rem" }}>Görevlerim</h2>
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        <Card title="Bekleyen onaylarım" value={c.openApprovalsMine} href="/yonetim/gorevler" hint={`Bunlardan gecikmiş: ${c.openApprovalsMineOverdue.toLocaleString("tr-TR")}`} />
      </div>

      {a.documents ? (
        <>
          <h2 style={{ fontSize: "1.1rem", marginTop: "1.5rem" }}>Sözleşmeler ve süreler</h2>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <Card title="Görünür sözleşme" value={c.contractsVisible} href="/yonetim/sozlesmeler" hint={`Aktif: ${c.contractsActive.toLocaleString("tr-TR")} · Süresi dolmuş: ${c.contractsExpired.toLocaleString("tr-TR")}`} />
            <Card title="90 gün içinde biten" value={c.endingWithin90} href="/yonetim/sozlesmeler" />
            <Card title="30 gün içinde ihbar son tarihi" value={c.noticeWithin30} />
            <Card title="90 gün içinde biten teminat" value={c.guaranteesWithin90} hint={`Sigorta poliçesi: ${c.insuranceWithin90.toLocaleString("tr-TR")}`} />
            <Card title="Geciken yükümlülük" value={c.obligationsOverdue} hint={`30 gün içinde vadesi gelen: ${c.obligationsWithin30.toLocaleString("tr-TR")}`} />
          </div>

          <h2 style={{ fontSize: "1.1rem", marginTop: "1.5rem" }}>Veri kalitesi</h2>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <Card title="Metadata eksik belge" value={c.metadataGapDocuments} href="/yonetim/belgeler" />
            <Card title="Saklama profili atanmamış belge" value={c.retentionGapDocuments} href="/yonetim/saklama" />
            <Card title="Sahipsiz (pasif sahipli) belge" value={c.ownerlessDocuments} />
          </div>
        </>
      ) : (
        <p style={{ marginTop: "1.5rem", color: "#57606a" }}>Belge ve sözleşme metrikleri için yetkiniz yok; bu bölüm gösterilmez.</p>
      )}

      {a.teamApprovals ? (
        <p style={{ marginTop: "1rem" }}>
          Ekip genelinde bekleyen sözleşme onayı: <strong>{c.openApprovalsTeam.toLocaleString("tr-TR")}</strong>
        </p>
      ) : null}

      {d.failedQueues ? (
        <section aria-labelledby="kuyruk" style={{ marginTop: "1.5rem" }}>
          <h2 id="kuyruk" style={{ fontSize: "1.1rem" }}>Arka plan işleri</h2>
          <p>Başarısız veya kalıcı hatalı iş: <strong>{d.failedQueues.total.toLocaleString("tr-TR")}</strong> <Link href="/yonetim/saglik">Sistem sağlığı</Link></p>
          {d.failedQueues.recent.length > 0 ? (
            <ul>
              {d.failedQueues.recent.map((j) => (
                <li key={j.id}>
                  {j.queue} / {j.name}: {j.status} {j.lastError ? `(${j.lastError})` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="son" style={{ marginTop: "1.5rem" }}>
        <h2 id="son" style={{ fontSize: "1.1rem" }}>Son işlemlerim</h2>
        {d.recentOperations.length === 0 ? (
          <p>Veri yok.</p>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.9rem" }}>
            <thead>
              <tr>
                <th scope="col" style={{ textAlign: "left" }}>Zaman</th>
                <th scope="col" style={{ textAlign: "left" }}>Olay</th>
                <th scope="col" style={{ textAlign: "left" }}>Sonuç</th>
              </tr>
            </thead>
            <tbody>
              {d.recentOperations.map((o) => (
                <tr key={o.id}>
                  <td>{o.occurredAt.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</td>
                  <td>{o.eventType}</td>
                  <td>{o.outcome}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="gorev-liste" style={{ marginTop: "1.5rem" }}>
        <h2 id="gorev-liste" style={{ fontSize: "1.1rem" }}>Yaklaşan onay görevlerim</h2>
        {d.mySla.length === 0 ? (
          <p>Veri yok.</p>
        ) : (
          <ul>
            {d.mySla.slice(0, 5).map((t) => (
              <li key={t.id}>
                {t.subjectTitle} · {SLA_LABEL[t.sla] ?? t.sla}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
