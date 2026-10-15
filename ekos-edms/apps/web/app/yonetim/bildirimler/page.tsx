// Bildirimlerim: uygulama içi kayıtlar (zorunlu) ve e-posta/Teams teslim durumları.
// "Yapılandırılmadı" yalnızca kanal gerçekten kurulu değilse gösterilir; teslim başarısızsa görev panoda yine görünür.
import { listMyNotifications } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { requireActor } from "../session-guard";
import { channelStatus } from "@/lib/server/jobs";
import { MarkReadButton } from "./MarkReadButton";

const DELIVERY_LABEL: Record<string, string> = {
  QUEUED: "Sırada",
  SENT: "Gönderildi",
  FAILED: "Başarısız (yeniden denenecek)",
  NOT_CONFIGURED: "Yapılandırılmadı",
};
const CHANNEL_LABEL: Record<string, string> = { EMAIL: "E-posta", TEAMS: "Teams", IN_APP: "Uygulama içi" };
const TD = { padding: "0.5rem", borderBottom: "1px solid #eee", verticalAlign: "top" as const };
const TH = { textAlign: "left" as const, borderBottom: "1px solid #ccc", padding: "0.5rem" };

export default async function BildirimlerPage(): Promise<React.JSX.Element> {
  const actor = await requireActor();
  const [items, channels] = await Promise.all([listMyNotifications(db(), { actor, limit: 100 }), channelStatus(db())]);
  const unread = items.filter((i) => i.readAt === null).length;
  return (
    <section>
      <h1>Bildirimler</h1>
      <p style={{ color: "#57606a" }}>
        Uygulama içi bildirimler her zaman gösterilir. E-posta ve Teams teslimi ayrıca yapılandırılır; teslim başarısız olsa bile ilgili görev Onaylar / Görevler ekranında görünmeye devam eder.
      </p>

      <div role="group" aria-label="Kanal durumu" style={{ display: "flex", gap: "1rem", flexWrap: "wrap", margin: "1rem 0" }}>
        <div style={{ border: "1px solid #d0d7de", borderRadius: 8, padding: "0.5rem 0.75rem" }}>
          <strong>E-posta:</strong> {channels.email === "READY" ? `Hazır (${channels.emailFrom ?? ""})` : "Yapılandırılmadı"}
        </div>
        <div style={{ border: "1px solid #d0d7de", borderRadius: 8, padding: "0.5rem 0.75rem" }}>
          <strong>Teams:</strong> {channels.teams === "READY" ? "Hazır" : "Yapılandırılmadı"}
        </div>
        <div style={{ border: "1px solid #d0d7de", borderRadius: 8, padding: "0.5rem 0.75rem" }}>
          <strong>Okunmamış:</strong> {unread}
        </div>
      </div>

      {items.length === 0 ? (
        <p role="status" style={{ border: "1px dashed #8c959f", padding: "1rem", borderRadius: 8 }}>
          Veri yok. Henüz bildiriminiz bulunmuyor.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.9rem" }}>
            <caption style={{ textAlign: "left", padding: "0.5rem 0" }}>Bildirimlerim (en yeni önce)</caption>
            <thead>
              <tr>
                <th scope="col" style={TH}>Bildirim</th>
                <th scope="col" style={TH}>Tarih</th>
                <th scope="col" style={TH}>Teslim</th>
                <th scope="col" style={TH}>Durum</th>
              </tr>
            </thead>
            <tbody>
              {items.map((n) => (
                <tr key={n.id} style={{ fontWeight: n.readAt ? 400 : 600 }}>
                  <td style={TD}>
                    <div>{n.title}</div>
                    <div style={{ color: "#57606a", fontWeight: 400 }}>{n.body}</div>
                  </td>
                  <td style={TD}>{n.createdAt.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</td>
                  <td style={TD}>
                    {n.deliveries.length === 0 ? (
                      <span>Teslim kanalı yok (yalnız uygulama içi)</span>
                    ) : (
                      <ul style={{ margin: 0, paddingLeft: "1rem" }}>
                        {n.deliveries.map((d, i) => (
                          <li key={`${d.channel}-${String(d.attemptNo)}-${String(i)}`}>
                            {CHANNEL_LABEL[d.channel] ?? d.channel}: {DELIVERY_LABEL[d.status] ?? d.status}
                            {d.errorCode ? ` (${d.errorCode})` : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td style={TD}>
                    {n.readAt ? (
                      <span style={{ color: "#57606a" }}>Okundu</span>
                    ) : (
                      <MarkReadButton id={n.id} title={n.title} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
