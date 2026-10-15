// Hatırlatmalar: aralık ayarı (config.manage), yaklaşan zamanlanmış olaylar ve elle çalıştırma.
// Kurulu olmayan kanallar "Yapılandırılmadı" olarak gösterilir; sahte başarı yazılmaz.
import { authorize } from "@ekos/core";
import { getReminderOffsets, listSettings, listUpcomingScheduled, SETTING_KEYS, DEFAULT_REMINDER_OFFSETS } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { channelStatus } from "@/lib/server/jobs";
import { requireActor } from "../session-guard";
import { OffsetsForm } from "./OffsetsForm";
import { RunJobsButton } from "./RunJobsButton";

const DEADLINE_LABEL: Record<string, string> = {
  CONTRACT_END: "Sözleşme bitişi",
  NOTICE_DEADLINE: "İhbar son tarihi",
  OBLIGATION_DUE: "Yükümlülük vadesi",
  INSURANCE_EXPIRY: "Sigorta bitişi",
  GUARANTEE_EXPIRY: "Teminat bitişi",
};
const TD = { padding: "0.5rem", borderBottom: "1px solid #eee" };
const TH = { textAlign: "left" as const, borderBottom: "1px solid #ccc", padding: "0.5rem" };

export default async function HatirlatmaPage(): Promise<React.JSX.Element> {
  const actor = await requireActor();
  const now = new Date();
  const canManage = authorize({ actor, permission: "config.manage", now }).allowed;
  const channels = await channelStatus(db());

  if (!canManage) {
    return (
      <section>
        <h1>Hatırlatmalar</h1>
        <p role="alert">Hatırlatma ayarlarını ve zamanlanmış olayları görmek için yönetici yetkisi gerekir. Kendi bildirimlerinize Bildirimler ekranından ulaşabilirsiniz.</p>
      </section>
    );
  }

  const [settings, offsets, upcoming] = await Promise.all([
    listSettings(db(), { actor, now }),
    getReminderOffsets(db()),
    listUpcomingScheduled(db(), { now, days: 90 }),
  ]);
  const offsetSetting = settings.find((s) => s.key === SETTING_KEYS.REMINDER_OFFSETS);
  const currentOffsets = offsetSetting?.current && Array.isArray((offsetSetting.current as { offsets?: unknown }).offsets)
    ? ((offsetSetting.current as { offsets: number[] }).offsets)
    : [...DEFAULT_REMINDER_OFFSETS];

  return (
    <section>
      <h1>Hatırlatmalar</h1>
      <p style={{ color: "#57606a" }}>
        Sözleşme, ihbar, yükümlülük ve sigorta/teminat tarihleri için hatırlatmalar bu aralıklara göre üretilir. Tarih değiştiğinde eski olaylar iptal edilir ve yenileri üretilir.
      </p>

      <div role="group" aria-label="Kanal durumu" style={{ display: "flex", gap: "1rem", flexWrap: "wrap", margin: "1rem 0" }}>
        <div style={{ border: "1px solid #d0d7de", borderRadius: 8, padding: "0.5rem 0.75rem" }}>
          <strong>E-posta:</strong> {channels.email === "READY" ? "Hazır" : "Yapılandırılmadı"}
        </div>
        <div style={{ border: "1px solid #d0d7de", borderRadius: 8, padding: "0.5rem 0.75rem" }}>
          <strong>Teams:</strong> {channels.teams === "READY" ? "Hazır" : "Yapılandırılmadı"}
        </div>
        <div style={{ border: "1px solid #d0d7de", borderRadius: 8, padding: "0.5rem 0.75rem" }}>
          <strong>Etkin aralıklar:</strong> {offsets.join(", ")} gün
        </div>
      </div>

      <div style={{ display: "grid", gap: "1.5rem", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
        <div style={{ display: "grid", gap: "1rem", alignContent: "start" }}>
          <OffsetsForm initial={currentOffsets} rowVersion={offsetSetting?.rowVersion ?? 0} />
          <div>
            <h2 style={{ fontSize: "1.05rem", margin: "0 0 0.5rem" }}>Elle çalıştırma</h2>
            <RunJobsButton />
          </div>
        </div>

        <div>
          <h2 style={{ fontSize: "1.05rem", margin: "0 0 0.5rem" }}>Önümüzdeki 90 gündeki zamanlanmış olaylar</h2>
          {upcoming.length === 0 ? (
            <p role="status" style={{ border: "1px dashed #8c959f", padding: "1rem", borderRadius: 8 }}>
              Veri yok. Önümüzdeki 90 günde zamanlanmış hatırlatma yok.
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.9rem" }}>
                <caption style={{ textAlign: "left", padding: "0.5rem 0" }}>Zamanlanmış hatırlatma olayları ({upcoming.length})</caption>
                <thead>
                  <tr>
                    <th scope="col" style={TH}>Tarih</th>
                    <th scope="col" style={TH}>Tür</th>
                    <th scope="col" style={TH}>Kaç gün önce</th>
                    <th scope="col" style={TH}>Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {upcoming.map((e) => (
                    <tr key={e.id}>
                      <td style={TD}>{e.deadlineDate.toISOString().slice(0, 10)}</td>
                      <td style={TD}>{DEADLINE_LABEL[e.deadlineType] ?? e.deadlineType}</td>
                      <td style={TD}>{e.offsetDays}</td>
                      <td style={TD}>Planlandı</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
