// Sağlık ekranı: dış sistemler kontrol edilmediği sürece "Bağlı" GÖSTERİLMEZ (A5/4).
const CHECKS: { name: string; status: string }[] = [
  { name: "Uygulama", status: "ÇALIŞIYOR" },
  { name: "Veritabanı", status: "KONTROL EDİLMEDİ" },
  { name: "Redis / kuyruk", status: "KONTROL EDİLMEDİ" },
  { name: "Depolama (S3/MinIO)", status: "KONTROL EDİLMEDİ" },
  { name: "Antivirüs (ClamAV)", status: "KONTROL EDİLMEDİ" },
  { name: "OCR", status: "KONTROL EDİLMEDİ" },
];

export default function SaglikPage(): React.JSX.Element {
  return (
    <section>
      <h1>Sistem sağlığı</h1>
      <table style={{ borderCollapse: "collapse", marginTop: "1rem" }}>
        <tbody>
          {CHECKS.map((c) => (
            <tr key={c.name}>
              <td style={{ padding: "0.5rem 1rem", borderBottom: "1px solid #d0d7de" }}>{c.name}</td>
              <td style={{ padding: "0.5rem 1rem", borderBottom: "1px solid #d0d7de" }}>{c.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
