// Çalışan ayrılışı (R-OFF). Vaka, sorumluluk kalemleri ve devir/feragat. Vaka listesi servisi yoktur: vaka kimliği ile açılır.
import Link from "next/link";
import { authorize } from "@ekos/core";
import { getOffboardingCase, listOffboardingCases, DomainError } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { requireActor } from "../session-guard";
import { OffboardingOpenForm, OffboardingItemActions, OffboardingCompleteButton, OffboardingCancelForm } from "./OffboardingForms";

const KIND: Record<string, string> = {
  DOCUMENT_OWNER: "Belge sahibi",
  CONTRACT_ROLE: "Sözleşme rolü",
  APPROVAL_TASK: "Bekleyen onay görevi",
  OBLIGATION_RESPONSIBLE: "Yükümlülük sorumlusu",
};
const ITEM_STATUS: Record<string, string> = { OPEN: "Açık", TRANSFERRED: "Devredildi", WAIVED: "Feragat edildi" };
const TH = { textAlign: "left" as const, borderBottom: "1px solid #ccc" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const CASE_STATUS_LABEL: Record<string, string> = { OPEN: "Açık", COMPLETED: "Tamamlandı", CANCELLED: "İptal edildi" };

export default async function AyrilisPage(props: {
  searchParams: Promise<{ case?: string; status?: string }>;
}): Promise<React.JSX.Element> {
  const actor = await requireActor();
  const now = new Date();
  if (!authorize({ actor, permission: "user.manage", now }).allowed) {
    return (
      <section>
        <h1>Çalışan ayrılışı</h1>
        <p role="alert">Bu ekran için yetkiniz yok.</p>
      </section>
    );
  }
  const sp = await props.searchParams;
  const caseId = sp.case;
  const statusFilter = sp.status === "OPEN" || sp.status === "COMPLETED" || sp.status === "CANCELLED" ? sp.status : null;
  const cases = await listOffboardingCases(db(), { actor, now, status: statusFilter });
  let kase: Awaited<ReturnType<typeof getOffboardingCase>> | null = null;
  let loadError: string | null = null;
  if (caseId && UUID_RE.test(caseId)) {
    try {
      kase = await getOffboardingCase(db(), { actor, now, caseId });
    } catch (err) {
      loadError = err instanceof DomainError && err.code === "NOT_FOUND" ? "Vaka bulunamadı." : "Vaka yüklenemedi.";
    }
  } else if (caseId) {
    loadError = "Geçersiz vaka kimliği.";
  }
  const open = kase ? kase.items.filter((i) => i.status === "OPEN").length : 0;

  return (
    <section>
      <h1>Çalışan ayrılışı</h1>
      <p>
        Ayrılan kişi adına işlem yapılamaz. Açık sorumluluklar devredilmeli veya gerekçeyle feragat edilmelidir. Geçmiş kayıtlar
        silinmez. Engel etkinse açık kalem varken vaka kapatılamaz.
      </p>
      <h2 style={{ fontSize: "1rem" }}>Ayrılış dosyaları</h2>
      <nav style={{ display: "flex", gap: "0.75rem", fontSize: "0.9rem", marginBottom: "0.5rem" }}>
        <Link href="/yonetim/ayrilis">Tümü</Link>
        <Link href="/yonetim/ayrilis?status=OPEN">Açık</Link>
        <Link href="/yonetim/ayrilis?status=COMPLETED">Tamamlanan</Link>
        <Link href="/yonetim/ayrilis?status=CANCELLED">İptal edilen</Link>
      </nav>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.9rem" }}>
        <thead>
          <tr>
            <th style={TH}>Kullanıcı</th>
            <th style={TH}>Açılış</th>
            <th style={TH}>Durum</th>
            <th style={TH}>Açık kalem</th>
            <th style={TH}>Dosya</th>
          </tr>
        </thead>
        <tbody>
          {cases.length === 0 && (
            <tr>
              <td colSpan={5}>Dosya yok.</td>
            </tr>
          )}
          {cases.map((c) => (
            <tr key={c.id}>
              <td>
                {c.userDisplayName} <span style={{ color: "#57606a" }}>({c.userEmail})</span>
              </td>
              <td>{c.openedAt.toISOString().slice(0, 16).replace("T", " ")}</td>
              <td>{CASE_STATUS_LABEL[c.status] ?? c.status}</td>
              <td>{c.status === "OPEN" ? String(c.openItemCount) : "—"}</td>
              <td>
                <Link href={`/yonetim/ayrilis?case=${c.id}`}>Aç</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ fontSize: "1rem", marginTop: "1.5rem" }}>Yeni vaka aç</h2>
      <OffboardingOpenForm />
      <h2 style={{ fontSize: "1rem", marginTop: "1.5rem" }}>Vaka görüntüle</h2>
      <form method="GET" style={{ display: "flex", gap: "0.5rem" }}>
        <input name="case" placeholder="Vaka kimliği (UUID)" defaultValue={caseId ?? ""} style={{ minWidth: 360 }} />
        <button type="submit">Aç</button>
      </form>
      {loadError && <p role="alert">{loadError}</p>}
      {kase && (
        <div style={{ marginTop: "1rem" }}>
          <p>
            Durum: <strong>{CASE_STATUS_LABEL[kase.status] ?? kase.status}</strong> · Kullanıcı: <code>{kase.userId}</code> · Engel:{" "}
            {kase.blockOnUnresolved ? "Açık kalem varken kapatma engelli" : "Engel yok"} · Açık kalem: {String(open)}
          </p>
          <p style={{ fontSize: "0.9rem" }}>Gerekçe: {kase.reason}</p>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.9rem" }}>
            <thead>
              <tr>
                <th style={TH}>Tür</th>
                <th style={TH}>Kaynak</th>
                <th style={TH}>Alan</th>
                <th style={TH}>Durum</th>
                <th style={TH}>Devir / not</th>
                <th style={TH}>İşlem</th>
              </tr>
            </thead>
            <tbody>
              {kase.items.length === 0 && (
                <tr>
                  <td colSpan={6}>Bu vakada sorumluluk kalemi bulunmuyor.</td>
                </tr>
              )}
              {kase.items.map((i) => (
                <tr key={i.id}>
                  <td>{KIND[i.kind] ?? i.kind}</td>
                  <td>
                    <code>{i.targetId}</code>
                  </td>
                  <td>{i.field}</td>
                  <td>{ITEM_STATUS[i.status] ?? i.status}</td>
                  <td>{i.status === "TRANSFERRED" ? `→ ${i.toUserId ?? "—"}` : (i.note ?? "—")}</td>
                  <td>
                    {i.status === "OPEN" && kase.status === "OPEN" ? (
                      <OffboardingItemActions caseId={kase.id} itemId={i.id} rowVersion={i.rowVersion} />
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {kase.status === "OPEN" && (
            <div style={{ marginTop: "1rem" }}>
              <OffboardingCompleteButton caseId={kase.id} rowVersion={kase.rowVersion} />
            </div>
          )}
          {kase.status === "OPEN" && (
            <div style={{ marginTop: "1.5rem" }}>
              <h3 style={{ fontSize: "0.95rem" }}>Dosyayı iptal et (çalışan kurumda kalıyor)</h3>
              <OffboardingCancelForm caseId={kase.id} rowVersion={kase.rowVersion} />
            </div>
          )}
          <p style={{ marginTop: "0.5rem", fontSize: "0.8rem" }}>
            <Link href={`/api/offboarding/${kase.id}`}>Ham vaka verisi (JSON)</Link>
          </p>
        </div>
      )}
    </section>
  );
}
