// Break-glass (olağanüstü erişim). Talep → gerekçe + süre → ikinci onay (farklı kişi) → süre sonunda otomatik geçersiz. Her adım audit'e yazılır.
import { authorize } from "@ekos/core";
import { listBreakGlassGrants } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { requireActor } from "../session-guard";
import { BreakGlassRequestForm, BreakGlassActions } from "./BreakGlassForms";

const TH = { textAlign: "left" as const, borderBottom: "1px solid #ccc" };
const STATUS: Record<string, string> = {
  REQUESTED: "Onay bekliyor",
  APPROVED: "Aktif / onaylı",
  REJECTED: "Reddedildi",
  REVOKED: "İptal edildi",
  EXPIRED: "Süresi doldu",
};

export default async function KirilmaCamPage(props: { searchParams: Promise<{ page?: string }> }): Promise<React.JSX.Element> {
  const actor = await requireActor();
  const now = new Date();
  const canApprove = authorize({ actor, permission: "breakglass.approve", now }).allowed;
  const sp = await props.searchParams;
  const pageNo = sp.page && /^\d{1,6}$/.test(sp.page) && Number(sp.page) >= 1 ? Number(sp.page) : 1;
  const { items: rows, hasMore } = await listBreakGlassGrants(db(), { actor, now, page: pageNo });
  return (
    <section>
      <h1>Kırılma-cam (break-glass)</h1>
      <p>
        Olağanüstü erişim yalnızca gerekçeli talep, süre sınırı ve talep edenden farklı bir onaycı ile açılır. Süre dolunca erişim
        otomatik sona erer. Tüm işlemler denetim kaydına yazılır.
      </p>
      <h2 style={{ fontSize: "1rem" }}>Yeni talep</h2>
      <BreakGlassRequestForm />
      <h2 style={{ fontSize: "1rem", marginTop: "1.5rem" }}>Talepler</h2>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.9rem" }}>
        <thead>
          <tr>
            <th style={TH}>Belge</th>
            <th style={TH}>Yetki</th>
            <th style={TH}>Gerekçe</th>
            <th style={TH}>Durum</th>
            <th style={TH}>Başlangıç</th>
            <th style={TH}>Bitiş</th>
            <th style={TH}>İşlem</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && pageNo === 1 && (
            <tr>
              <td colSpan={7}>Talep yok.</td>
            </tr>
          )}
          {rows.map((g) => (
            <tr key={g.id}>
              <td>
                <code>{g.subjectId}</code>
              </td>
              <td>{g.permissionCode}</td>
              <td>{g.reason}</td>
              <td>{STATUS[g.status] ?? g.status}</td>
              <td>{g.startsAt ? g.startsAt.toISOString().slice(0, 16).replace("T", " ") : "—"}</td>
              <td>{g.expiresAt ? g.expiresAt.toISOString().slice(0, 16).replace("T", " ") : "—"}</td>
              <td>
                <BreakGlassActions
                  grantId={g.id}
                  status={g.status}
                  isRequester={g.requesterId === actor.userId}
                  canApprove={canApprove}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <nav style={{ display: "flex", gap: "1rem", marginTop: "1rem", fontSize: "0.9rem" }}>
        {pageNo > 1 && <a href={`/yonetim/kirilma-cam?page=${String(pageNo - 1)}`}>← Önceki sayfa</a>}
        <span>Sayfa {String(pageNo)}</span>
        {hasMore && <a href={`/yonetim/kirilma-cam?page=${String(pageNo + 1)}`}>Sonraki sayfa →</a>}
      </nav>
    </section>
  );
}
