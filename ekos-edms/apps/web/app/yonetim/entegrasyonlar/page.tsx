// Entegrasyon durumu ekranı. Kimlik bilgisi yoksa "Yapılandırılmadı"; sahte "Bağlı" gösterilmez. Gizli değer gösterilmez (yalnız değişken adları).
import { ENTRA_REQUIRED_ENV, ENTRA_KEY, ESIGN_KEY, ESIGN_REQUIRED_ENV, AI_KEY, SHAREPOINT_KEY, SHAREPOINT_REQUIRED_ENV, GRAPH_MAIL_KEY, GRAPH_MAIL_REQUIRED_ENV, ERP_KEY } from "@ekos/adapters";
import { getIntegrationHealth, listDeadJobs } from "@ekos/db";
import { db } from "@/lib/server/runtime";

const CATALOG = [
  { key: ENTRA_KEY, displayName: "Entra ID (OIDC giriş, grup eşlemesi)", requiredEnv: ENTRA_REQUIRED_ENV, critical: true },
  { key: GRAPH_MAIL_KEY, displayName: "E-posta (Microsoft Graph)", requiredEnv: GRAPH_MAIL_REQUIRED_ENV, critical: false },
  { key: SHAREPOINT_KEY, displayName: "SharePoint içe aktarım", requiredEnv: SHAREPOINT_REQUIRED_ENV, critical: false },
  { key: ESIGN_KEY, displayName: "E-imza sağlayıcısı", requiredEnv: ESIGN_REQUIRED_ENV, critical: false },
  { key: ERP_KEY, displayName: "ERP / satın alma", requiredEnv: [] as string[], critical: false },
  { key: AI_KEY, displayName: "Yapay zekâ (AI sağlayıcı)", requiredEnv: ["AI_PROVIDER", "AI_MODEL", "AI_DATA_PROCESSING_APPROVED"], critical: false },
];

const LABEL: Record<string, string> = {
  NOT_CONFIGURED: "Yapılandırılmadı",
  CONFIGURED_UNVERIFIED: "Yapılandırıldı (doğrulanmadı)",
  CONNECTED: "Bağlı",
  FAILED: "Hata",
};

export default async function EntegrasyonlarPage(): Promise<React.JSX.Element> {
  const rows = await getIntegrationHealth(db(), CATALOG, process.env);
  const dead = await listDeadJobs(db(), "integration", 20);
  const cell = { padding: "0.5rem 1rem", borderBottom: "1px solid #d0d7de", verticalAlign: "top" } as const;
  return (
    <section>
      <h1>Entegrasyonlar</h1>
      <p style={{ color: "#444" }}>Durumlar kimlik bilgisi ve son doğrulamaya göre belirlenir. Gizli değerler bu ekranda gösterilmez.</p>
      <table style={{ borderCollapse: "collapse", marginTop: "1rem", width: "100%" }}>
        <thead>
          <tr>
            <th style={cell}>Entegrasyon</th>
            <th style={cell}>Durum</th>
            <th style={cell}>Son senkron</th>
            <th style={cell}>Son hata kodu</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td style={cell}>
                {r.displayName}
                {r.critical ? <span style={{ color: "#b42318" }}> (kritik)</span> : null}
              </td>
              <td style={cell}>{LABEL[r.status] ?? r.status}</td>
              <td style={cell}>{r.lastSyncAt ? r.lastSyncAt.toISOString().replace("T", " ").slice(0, 16) : "—"}</td>
              <td style={cell}>{r.lastError ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ marginTop: "2rem" }}>Hata kuyruğu (ölü işler)</h2>
      {dead.length === 0 ? (
        <p>Kalıcı hatalı iş yok.</p>
      ) : (
        <table style={{ borderCollapse: "collapse", marginTop: "0.5rem", width: "100%" }}>
          <tbody>
            {dead.map((j) => (
              <tr key={j.id}>
                <td style={cell}>{j.name}</td>
                <td style={cell}>{String(j.attempts)} deneme</td>
                <td style={cell}>{j.lastError ?? "—"}</td>
                <td style={cell}>{j.updatedAt.toISOString().slice(0, 16).replace("T", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
