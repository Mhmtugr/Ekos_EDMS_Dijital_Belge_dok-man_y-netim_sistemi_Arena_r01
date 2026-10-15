// Toplu içe aktarma ekranı. Yetki yoksa form gösterilmez.
import { hasUnrestrictedGrant } from "@/lib/server/grants";
import { requireActor } from "../session-guard";
import { ImportForm } from "./ImportForm";

export default async function IceAktarimPage(): Promise<React.JSX.Element> {
  const actor = await requireActor();
  const can = { allowed: hasUnrestrictedGrant(actor, "document.upload") };
  if (!can.allowed) {
    return (
      <section>
        <h1>Toplu içe aktarma</h1>
        <p role="alert">Toplu içe aktarma izniniz yok.</p>
      </section>
    );
  }
  return (
    <section>
      <h1>Toplu içe aktarma</h1>
      <p style={{ color: "#57606a" }}>
        CSV manifest yükleyin. Dosya taramadan geçmeden içe aktarma başlamaz. Hatalı satırlar satır numarasıyla raporlanır; geçerli satırlar yine de işlenir.
      </p>
      <ImportForm />
    </section>
  );
}
