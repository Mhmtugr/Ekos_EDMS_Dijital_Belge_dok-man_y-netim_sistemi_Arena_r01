// Belge arama. Yetki filtresi sorgunun içindedir (searchDocuments); burada ek süzme yapılmaz.
import Link from "next/link";
import { listSavedViews, searchDocuments } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { requireActor, INGEST_LABEL } from "../session-guard";
import { SavedViews } from "./SavedViews";
import { limits } from "@/lib/server/limits";

export default async function BelgelerPage(props: { searchParams: Promise<{ q?: string; cursor?: string }> }): Promise<React.JSX.Element> {
  const actor = await requireActor();
  const sp = await props.searchParams;
  const q = (sp.q ?? "").trim().slice(0, 200);
  const page = q === "" ? null : await searchDocuments(db(), { actor, now: new Date(), query: q, limit: Math.min(20, limits().searchPageMax), ...(sp.cursor ? { cursor: sp.cursor } : {}) });
  const views = await listSavedViews(db(), actor.userId);

  return (
    <section>
      <h1>Belgeler</h1>
      <form method="get" style={{ display: "flex", gap: "0.5rem", margin: "1rem 0" }}>
        <input name="q" defaultValue={q} placeholder="Ara (Türkçe karakterler serbest)" style={{ flex: 1, padding: "0.5rem" }} />
        <button type="submit">Ara</button>
      </form>
      {page === null && <p>Aramak için bir sözcük girin. Yalnızca göründüğünüz belgeler listelenir.</p>}
      {page !== null && page.items.length === 0 && <p>Sonuç bulunamadı.</p>}
      {page !== null && page.items.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #d0d7de" }}>
              <th>Numara</th>
              <th>Başlık</th>
              <th>Durum</th>
              <th>Gizlilik</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((d) => (
              <tr key={d.id} style={{ borderBottom: "1px solid #eaeef2" }}>
                <td>{d.number}</td>
                <td>
                  <Link href={`/yonetim/belgeler/${d.id}`}>{d.title}</Link>
                </td>
                <td>{INGEST_LABEL[d.ingestStatus] ?? d.ingestStatus}</td>
                <td>{d.confidentiality}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {page?.nextCursor && (
        <p>
          <a href={`/yonetim/belgeler?q=${encodeURIComponent(q)}&cursor=${encodeURIComponent(page.nextCursor)}`}>Sonraki sayfa</a>
        </p>
      )}
      <SavedViews
        currentQuery={q}
        views={views.map((v) => ({ id: v.id, name: v.name, href: `/yonetim/belgeler?q=${encodeURIComponent((v.criteria as { query: string }).query)}` }))}
      />
    </section>
  );
}
