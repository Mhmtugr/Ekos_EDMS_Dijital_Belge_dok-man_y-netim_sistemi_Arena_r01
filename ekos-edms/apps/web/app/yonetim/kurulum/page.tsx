// Kurulum sihirbazı: kritik yapılandırmanın durumu, bloke ettiği işlev ve ikinci onay akışı.
// Yalnız config.manage. Gizli değerler ekranda yazılmaz; yalnız ortam değişkeninin tanımlı olup olmadığı gösterilir.
import { authorize } from "@ekos/core";
import { listSettings } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { requireActor } from "../session-guard";
import { SettingsEditor, type SettingProps } from "./SettingsEditor";


export default async function KurulumPage(): Promise<React.JSX.Element> {
  const actor = await requireActor();
  const now = new Date();
  if (!authorize({ actor, permission: "config.manage", now }).allowed) {
    return (
      <section>
        <h1>Kurulum</h1>
        <p role="alert">Kurulum ekranına erişmek için yönetici yetkisi (yapılandırma) gerekir.</p>
      </section>
    );
  }
  const views = await listSettings(db(), { actor, now });
  const items: SettingProps[] = views.map((v) => {
    const secretRef = typeof v.current?.secretRef === "string" ? v.current.secretRef : typeof v.pending?.value.secretRef === "string" ? (v.pending.value.secretRef) : null;
    return {
      key: v.key,
      label: v.label,
      critical: v.critical,
      blocks: v.blocks,
      status: v.status,
      rowVersion: v.rowVersion,
      current: v.current,
      pending: v.pending ? { value: v.pending.value, proposedById: v.pending.proposedById, proposedAt: v.pending.proposedAt } : null,
      envReady: secretRef ? !!process.env[secretRef]?.trim() : false,
    };
  });
  const required = items.filter((i) => i.status !== "COMPLETED" && i.critical);
  const done = items.filter((i) => i.status === "COMPLETED").length;

  return (
    <section>
      <h1>Kurulum</h1>
      <p style={{ color: "#57606a" }}>
        Tamamlanan: {done} / {items.length}. Tamamlanmayan kritik ayarlar, bağlı işlevleri gösterilmez ya da "Yapılandırılmadı" olarak işaretlenir.
      </p>
      {required.length > 0 ? (
        <div role="region" aria-label="Eksik kritik yapılandırma" style={{ border: "1px solid #d4a72c", background: "#fff8c5", borderRadius: 8, padding: "0.75rem 1rem", margin: "1rem 0" }}>
          <strong>Eksik kritik yapılandırma:</strong>
          <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem" }}>
            {required.map((r) => (
              <li key={r.key}>
                {r.label}: {r.blocks}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p role="status" style={{ border: "1px solid #1a7f37", borderRadius: 8, padding: "0.75rem 1rem" }}>
          Tüm kritik yapılandırmalar tamamlandı.
        </p>
      )}
      <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", marginTop: "1rem" }}>
        {items.map((s) => (
          <SettingsEditor key={s.key} s={s} actorId={actor.userId} />
        ))}
      </div>
    </section>
  );
}
