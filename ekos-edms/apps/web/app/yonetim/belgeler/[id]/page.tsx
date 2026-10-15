// Belge detayı. Görünmeyen belge 404 (varlık sızmaz); görünür ama izinsiz 403 gösterilir.
// Kopya tespiti: yalnızca görünür belgeler listelenir (SHA-256 birebir eşleşme). Metadata benzerliği yalnız uyarıdır.
import Link from "next/link";
import { notFound } from "next/navigation";
import { authorize, type ActorContext } from "@ekos/core";
import { DomainError, findVisibleDuplicates, getRetentionStatus, guardDocument, listLegalHolds, listRelations, listRetentionProfiles } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { requireActor, INGEST_LABEL } from "../../session-guard";
import { DocActions } from "./DocActions";
import { RetentionPanel, type HoldView } from "./RetentionPanel";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function BelgeDetayPage(props: { params: Promise<{ id: string }> }): Promise<React.JSX.Element> {
  const actor: ActorContext = await requireActor();
  const { id } = await props.params;
  if (!UUID_RE.test(id)) notFound();

  let doc;
  try {
    doc = await guardDocument(db(), { actor, now: new Date(), documentId: id, permission: "document.view_metadata" });
  } catch (err) {
    if (err instanceof DomainError && err.code === "NOT_FOUND") notFound();
    if (err instanceof DomainError && err.code === "FORBIDDEN") {
      return <p role="alert">Bu belgeyi görüntüleme izniniz yok.</p>;
    }
    throw err;
  }

  const full = await db().document.findUniqueOrThrow({
    where: { id: doc.id },
    include: {
      type: { select: { name: true } },
      versions: { orderBy: { versionNumber: "desc" }, include: { fileObject: { select: { scanStatus: true, originalFileName: true, sha256: true } } } },
    },
  });
  const current = full.versions[0];
  const fileClean = current?.fileObject?.scanStatus === "CLEAN";
  const relations = await listRelations(db(), { actor, now: new Date(), documentId: doc.id });
  const location = await db().physicalArchiveLocation.findUnique({ where: { documentId: doc.id } });

  const duplicateIds = current?.fileObject?.sha256
    ? (await findVisibleDuplicates(db(), actor, new Date(), current.fileObject.sha256)).filter((x) => x !== doc.id)
    : [];
  const duplicates = duplicateIds.length
    ? await db().document.findMany({ where: { id: { in: duplicateIds } }, select: { id: true, number: true, title: true } })
    : [];

  const canNewVersion = authorize({ actor, permission: "document.new_version", now: new Date() }).allowed;
  const canEditLocation = authorize({ actor, permission: "document.archive", now: new Date() }).allowed;
  const nowRet = new Date();
  const canHold = authorize({ actor, permission: "document.legal_hold", now: nowRet }).allowed;
  const canRetention = authorize({ actor, permission: "document.retention_review", now: nowRet }).allowed;
  const retention = await getRetentionStatus(db(), { actor, now: nowRet, documentId: doc.id });
  const holdRows = await listLegalHolds(db(), { actor, now: nowRet, documentId: doc.id });
  const holds: HoldView[] = holdRows.map((h) => ({
    id: h.id,
    reason: h.reason,
    placedAt: h.placedAt.toISOString(),
    releasedAt: h.releasedAt ? h.releasedAt.toISOString() : null,
    scopeNote: h.scopeNote ?? null,
  }));
  const canListProfiles =
    authorize({ actor, permission: "config.manage", now: nowRet }).allowed || authorize({ actor, permission: "contract.legal_review", now: nowRet }).allowed;
  const profiles = canRetention && canListProfiles ? await listRetentionProfiles(db(), { actor, now: nowRet }) : [];

  return (
    <section>
      <p>
        <Link href="/yonetim/belgeler">← Belgeler</Link>
      </p>
      <h1>{doc.title}</h1>
      <dl style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: "0.4rem 1rem" }}>
        <dt>Numara</dt>
        <dd>{doc.number}</dd>
        <dt>Tür</dt>
        <dd>{full.type.name}</dd>
        <dt>Durum</dt>
        <dd>{INGEST_LABEL[doc.ingestStatus] ?? doc.ingestStatus}</dd>
        <dt>Gizlilik</dt>
        <dd>{doc.confidentiality}</dd>
        <dt>Sürüm</dt>
        <dd>{current ? String(current.versionNumber) : "Sürüm yok"}</dd>
        <dt>Dosya</dt>
        <dd>{current?.fileObject?.originalFileName ?? "—"}</dd>
        <dt>SHA-256</dt>
        <dd style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{current?.sha256 ?? "—"}</dd>
        <dt>Fiziksel konum</dt>
        <dd>
          {location
            ? `Kutu ${location.box ?? "—"} · Dosya ${location.file ?? "—"} · Raf ${location.shelf ?? "—"}${location.originalVerified ? " · Orijinal doğrulandı" : ""}`
            : "Kayıtlı değil"}
        </dd>
      </dl>

      <p style={{ marginTop: "1rem" }}>
        {fileClean ? (
          <a href={`/api/documents/${doc.id}/preview`} target="_blank" rel="noreferrer">
            Önizle
          </a>
        ) : (
          <span>Önizleme yok: dosya taranmadı veya taranamadı.</span>
        )}
      </p>

      {duplicates.length > 0 && (
        <div role="alert" style={{ background: "#fff8c5", border: "1px solid #d4a72c", padding: "0.75rem", borderRadius: 6, marginTop: "1rem" }}>
          <strong>Aynı içerik (SHA-256) başka görünür belgelerde de var:</strong>
          <ul>
            {duplicates.map((d) => (
              <li key={d.id}>
                <Link href={`/yonetim/belgeler/${d.id}`}>
                  {d.number} — {d.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h2 style={{ fontSize: "1.1rem", marginTop: "1.5rem" }}>Sürüm geçmişi</h2>
      <p style={{ fontSize: "0.9rem", color: "#57606a" }}>Önceki sürümler salt okunurdur ve silinmez; yeni sürüm yalnızca yeni kayıt olarak eklenir.</p>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.9rem" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Sürüm</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Dosya</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Tarama</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>SHA-256</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Tarih (UTC)</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Durum</th>
          </tr>
        </thead>
        <tbody>
          {full.versions.map((v) => (
            <tr key={v.id}>
              <td>{v.versionNumber}{v.versionNumber === current?.versionNumber ? " (güncel)" : ""}</td>
              <td>{v.fileObject?.originalFileName ?? "—"}</td>
              <td>{v.fileObject?.scanStatus ?? "—"}</td>
              <td><code>{v.sha256.slice(0, 12)}…</code></td>
              <td>{v.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
              <td>{v.supersededAt ? "Yerine geçildi" : v.isSigned ? "İmzalı (kilitli)" : "Aktif"}{v.changeReason ? ` — ${v.changeReason}` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ fontSize: "1.1rem", marginTop: "1.5rem" }}>İlişkili belgeler</h2>
      {relations.length === 0 ? (
        <p>İlişkili belge yok.</p>
      ) : (
        <ul>
          {relations.map((r) => (
            <li key={`${r.document.id}-${r.relationType}-${r.direction}`}>
              <Link href={`/yonetim/belgeler/${r.document.id}`}>
                {r.document.number} — {r.document.title}
              </Link>{" "}
              ({r.relationType})
            </li>
          ))}
        </ul>
      )}

      <DocActions
        docId={doc.id}
        rowVersion={doc.rowVersion}
        locationRowVersion={location?.rowVersion ?? 0}
        canNewVersion={canNewVersion}
        canEditLocation={canEditLocation}
      />

      <dl style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: "0.4rem 1rem", marginTop: "1.5rem", fontSize: "0.9rem" }}>
        <dt>Saklama profili</dt>
        <dd>{retention.profile ? `${retention.profile.code}${retention.profile.verifiedByLegal ? " (hukuken doğrulandı)" : " (doğrulanmadı)"}` : "Atanmamış"}</dd>
        <dt>Politika</dt>
        <dd>{retention.policyGap ? "Politika eksiği: imha edilemez (politika bekleniyor)" : "Tam"}</dd>
        <dt>Başlangıç olayı</dt>
        <dd>{retention.startEvent ?? "Kaydedilmedi"}</dd>
        <dt>Vade (son saklama tarihi)</dt>
        <dd>{retention.dueDate ?? "politika bekliyor"}</dd>
        <dt>Bekletme</dt>
        <dd>{retention.legalHoldActive ? "AKTİF — imha/kalıcı silme bloke" : "Yok"}</dd>
        <dt>Hukuk / KVKK incelemesi</dt>
        <dd>{retention.legalReviewRequired ? "Gerekli işaretli" : "Gerekli değil"}</dd>
        <dt>İmha uygunluğu</dt>
        <dd>{retention.eligible ? "Uygun" : `Uygun değil${retention.blocks.length ? ` (${retention.blocks.join(", ")})` : ""}`}</dd>
      </dl>

      <RetentionPanel
        docId={doc.id}
        docRowVersion={doc.rowVersion}
        canHold={canHold}
        canRetention={canRetention}
        holds={holds}
        profiles={profiles.map((p) => ({ id: p.id, code: p.code }))}
        currentProfileId={full.retentionProfileId ?? null}
      />
    </section>
  );
}
