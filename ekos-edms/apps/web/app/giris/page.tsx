// Giriş ekranı. ADR-0003: AUTH_MODE açıkça seçilmelidir; tanımsızsa yerel moda sessiz düşüş YOKTUR.
import type { CSSProperties } from "react";
import { LoginForm } from "./LoginForm";

const card: CSSProperties = {
  maxWidth: 420,
  margin: "4rem auto",
  padding: "2rem",
  border: "1px solid #d0d7de",
  borderRadius: 8,
  fontFamily: "system-ui, sans-serif",
};

export default function GirisPage(): React.JSX.Element {
  const mode = process.env.AUTH_MODE;

  if (mode !== "oidc" && mode !== "local") {
    return (
      <main style={card}>
        <h1 style={{ fontSize: "1.25rem" }}>Kimlik modu yapılandırılmadı</h1>
        <p>
          <code>AUTH_MODE</code> ortam değişkeni <code>oidc</code> veya <code>local</code> olarak ayarlanmalıdır. Tanımsız
          durumda sistem giriş kabul etmez.
        </p>
      </main>
    );
  }

  if (mode === "oidc") {
    return (
      <main style={card}>
        <h1 style={{ fontSize: "1.25rem" }}>Kurumsal giriş</h1>
        <p>Kurumsal kimlik sağlayıcısı (Entra ID) henüz yapılandırılmadı.</p>
        <button type="button" disabled>
          Kurumsal girişle devam et
        </button>
        <p style={{ color: "#57606a", fontSize: "0.875rem" }}>Hata kodu: IDP_NOT_CONFIGURED</p>
      </main>
    );
  }

  return (
    <main style={card}>
      <h1 style={{ fontSize: "1.25rem" }}>Yerel giriş</h1>
      <p role="note" style={{ background: "#fff8c5", padding: "0.5rem", borderRadius: 6, fontSize: "0.875rem" }}>
        Kurumsal SSO (Entra ID) yapılandırılmadı. Bu yerel moddur.
      </p>
      <LoginForm />
    </main>
  );
}
