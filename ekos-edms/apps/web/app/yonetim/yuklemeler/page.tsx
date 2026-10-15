// Belge yükleme ekranı. Yetki yoksa form gösterilmez.
import { hasActiveGrant } from "@/lib/server/grants";
import { db } from "@/lib/server/runtime";
import { listActiveCounterparties } from "@ekos/db";
import { requireActor } from "../session-guard";
import { UploadForm } from "./UploadForm";

export default async function YuklemelerPage(): Promise<React.JSX.Element> {
  const actor = await requireActor();
  if (!hasActiveGrant(actor, ["document.upload"])) {
    return (
      <section>
        <h1>Yükleme</h1>
        <p role="alert">Belge yükleme izniniz yok.</p>
      </section>
    );
  }
  const types = await db().documentType.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { code: true, name: true, requiredMetadataKeys: true },
  });
  const counterparties = await listActiveCounterparties(db());
  // Yükleyebileceği birimler: kurum geneli üyelikte tüm aktif birimler; kapsamlıysa yalnız kendi birimleri.
  const unrestricted = actor.memberships.some((m) => (m.scope.departmentIds ?? []).length === 0);
  const scopedIds = [...new Set(actor.memberships.flatMap((m) => m.scope.departmentIds ?? []))];
  const departments = await db().department.findMany({
    where: unrestricted ? { isActive: true } : { id: { in: scopedIds }, isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return (
    <section>
      <h1>Belge yükleme</h1>
      <p>Dosya önce karantinaya alınır. Tarama temiz dönmeden önizleme ve OCR başlamaz.</p>
      <UploadForm
        types={types.map((t) => ({ code: t.code, name: t.name, requiredKeys: t.requiredMetadataKeys }))}
        counterparties={counterparties}
        departments={departments}
      />
    </section>
  );
}
