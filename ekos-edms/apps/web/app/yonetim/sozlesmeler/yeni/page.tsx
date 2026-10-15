// Yeni sözleşme (taslak). Yalnız contract.create sahipleri; karşı taraf ve birim yalnız aktif kayıtlardan seçilir.
import Link from "next/link";
import { db } from "@/lib/server/runtime";
import { hasActiveGrant } from "@/lib/server/grants";
import { requireActor } from "../../session-guard";
import { NewContractForm } from "./NewContractForm";

export default async function YeniSozlesmePage(): Promise<React.JSX.Element> {
  const actor = await requireActor();
  if (!hasActiveGrant(actor, ["contract.create"])) {
    return (
      <section>
        <h1>Yeni sözleşme</h1>
        <p role="alert">Sözleşme oluşturmak için yetkiniz yok.</p>
      </section>
    );
  }
  const [counterparties, departments] = await Promise.all([
    db().counterparty.findMany({ where: { status: "ACTIVE" }, orderBy: { officialName: "asc" }, take: 500, select: { id: true, officialName: true, countryCode: true } }),
    db().department.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, take: 200, select: { id: true, name: true } }),
  ]);
  return (
    <section>
      <p>
        <Link href="/yonetim/sozlesmeler">← Sözleşmeler</Link>
      </p>
      <h1>Yeni sözleşme</h1>
      <NewContractForm counterparties={counterparties} departments={departments} />
    </section>
  );
}
