// Sözleşme listesi: filtre (metin, bitiş tarihi aralığı), sayfalama. Görünürlük servis katmanında uygulanır.
import Link from "next/link";
import { hasAnyGrant, listContracts } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { requireActor } from "../session-guard";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Taslak", IN_REVIEW: "İncelemede", PENDING_APPROVAL: "Onay bekliyor", READY_FOR_SIGNATURE: "İmzaya hazır",
  PENDING_SIGNATURE: "İmza bekliyor", ACTIVE: "Aktif", AMENDMENT_PENDING: "Değişiklik bekliyor", RENEWAL_REVIEW: "Yenileme incelemesi",
  EXPIRED: "Süresi doldu", TERMINATED: "Feshedildi", CANCELLED: "İptal", ARCHIVED: "Arşiv", DISPOSAL_REVIEW: "İmha incelemesi",
  DISPOSED: "İmha edildi", INVALID: "Geçersiz",
};

export default async function SozlesmelerPage(props: { searchParams: Promise<Record<string, string | undefined>> }): Promise<React.JSX.Element> {
  const actor = await requireActor();
  const now = new Date();
  if (!hasAnyGrant(actor, "document.list", now)) {
    return (
      <section>
        <h1>Sözleşmeler</h1>
        <p role="alert">Sözleşme listesini görüntüleme yetkiniz yok.</p>
      </section>
    );
  }
  const q = await props.searchParams;
  const endFrom = q.endFrom && DATE_RE.test(q.endFrom) ? q.endFrom : undefined;
  const endTo = q.endTo && DATE_RE.test(q.endTo) ? q.endTo : undefined;
  const page = Math.max(Number(q.page ?? 1) || 1, 1);
  const text = (q.q ?? "").slice(0, 100);
  const result = await listContracts(db(), { actor, now, q: text, endFrom, endTo, page, pageSize: 25 });
  const pages = Math.max(Math.ceil(result.total / result.pageSize), 1);
  const qs = (p: number) => {
    const u = new URLSearchParams();
    if (text) u.set("q", text);
    if (endFrom) u.set("endFrom", endFrom);
    if (endTo) u.set("endTo", endTo);
    u.set("page", String(p));
    return `?${u.toString()}`;
  };

  return (
    <section>
      <h1>Sözleşmeler</h1>
      <form method="get" role="search" aria-label="Sözleşme arama" style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "end", margin: "1rem 0" }}>
        <label style={{ display: "flex", flexDirection: "column", fontSize: "0.9rem" }}>
          Arama (başlık, belge no, kurumsal no)
          <input name="q" defaultValue={text} maxLength={100} style={{ padding: "0.4rem", minWidth: 240 }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: "0.9rem" }}>
          Bitiş başlangıcı
          <input type="date" name="endFrom" defaultValue={endFrom ?? ""} style={{ padding: "0.4rem" }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: "0.9rem" }}>
          Bitiş sonu
          <input type="date" name="endTo" defaultValue={endTo ?? ""} style={{ padding: "0.4rem" }} />
        </label>
        <button type="submit" style={{ padding: "0.45rem 1rem" }}>
          Filtrele
        </button>
      </form>

      <p style={{ margin: "0.5rem 0" }}>
        <Link href="/yonetim/sozlesmeler/yeni">+ Yeni sözleşme</Link>
      </p>
      <p aria-live="polite">{result.total.toLocaleString("tr-TR")} sözleşme bulundu.</p>
      {result.items.length === 0 ? (
        <p role="status" style={{ border: "1px dashed #8c959f", padding: "1rem", borderRadius: 8 }}>
          Veri yok. Filtrelerle eşleşen sözleşme bulunmuyor.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.9rem" }}>
            <caption style={{ textAlign: "left", padding: "0.5rem 0" }}>Sözleşme listesi, bitiş tarihine göre sıralı</caption>
            <thead>
              <tr>
                <th scope="col" style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.4rem" }}>Belge no</th>
                <th scope="col" style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.4rem" }}>Başlık</th>
                <th scope="col" style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.4rem" }}>Karşı taraf</th>
                <th scope="col" style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.4rem" }}>Durum</th>
                <th scope="col" style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.4rem" }}>Bitiş</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((r) => (
                <tr key={r.id}>
                  <td style={{ padding: "0.4rem" }}>{r.number}</td>
                  <td style={{ padding: "0.4rem" }}>
                    <Link href={`/yonetim/sozlesmeler/${r.id}`}>{r.title}</Link>
                  </td>
                  <td style={{ padding: "0.4rem" }}>{r.counterpartyName}</td>
                  <td style={{ padding: "0.4rem" }}>{r.contractStatus ? (STATUS_LABEL[r.contractStatus] ?? r.contractStatus) : "—"}</td>
                  <td style={{ padding: "0.4rem" }}>{r.endDate ?? "Belirsiz"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav aria-label="Sayfalama" style={{ display: "flex", gap: "1rem", marginTop: "1rem", alignItems: "center" }}>
        {page > 1 ? <Link href={qs(page - 1)}>Önceki sayfa</Link> : <span aria-disabled="true" style={{ color: "#8c959f" }}>Önceki sayfa</span>}
        <span>
          Sayfa {page} / {pages}
        </span>
        {page < pages ? <Link href={qs(page + 1)}>Sonraki sayfa</Link> : <span aria-disabled="true" style={{ color: "#8c959f" }}>Sonraki sayfa</span>}
      </nav>
    </section>
  );
}
