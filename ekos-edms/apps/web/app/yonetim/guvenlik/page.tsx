// Hesap güvenliği: iki adımlı doğrulama durumu ve kurulumu.
import { db, totpKey } from "@/lib/server/runtime";
import { requireActor } from "../session-guard";
import { TotpSetup } from "./TotpSetup";

export default async function GuvenlikPage(): Promise<React.JSX.Element> {
  const actor = await requireActor();
  const user = await db().user.findUniqueOrThrow({ where: { id: actor.userId }, select: { totpEnabledAt: true, totpSecretCipher: true } });
  const keyConfigured = totpKey() !== null;
  return (
    <section>
      <h1>Hesap güvenliği</h1>
      <h2 style={{ fontSize: "1rem", marginTop: "1.5rem" }}>İki adımlı doğrulama (TOTP)</h2>
      {user.totpEnabledAt ? (
        <p>
          Durum: <strong>Etkin</strong> (etkinleşme: {user.totpEnabledAt.toISOString().slice(0, 16).replace("T", " ")} UTC). Kurtarma gerekiyorsa sistem yöneticisi CLI ile sıfırlayabilir.
        </p>
      ) : !keyConfigured ? (
        <p role="alert">
          Sunucuda TOTP_ENCRYPTION_KEY tanımlı değil; iki adımlı doğrulama kurulamaz. Yöneticinize başvurun.
        </p>
      ) : (
        <>
          <p>Durum: <strong>Etkin değil</strong>. Kurulum tamamlanana kadar giriş yalnızca parolayla yapılır.</p>
          <TotpSetup />
        </>
      )}
    </section>
  );
}
