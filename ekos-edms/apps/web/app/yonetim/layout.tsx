// Yönetim kabuğu. Her sayfa oturum kapısından geçer; oturum yoksa giriş ekranına gidilir.
// Gezinme: ana bölümler ve "Yönetim" grubu (saklama, imha, ayrılış, kırılma-cam, hesap güvenliği).
import Link from "next/link";
import type { ReactNode } from "react";
import { requireActor } from "./session-guard";
import { LogoutButton } from "./LogoutButton";

const MAIN: { href: string; label: string }[] = [
  { href: "/yonetim", label: "Genel Bakış" },
  { href: "/yonetim/belgeler", label: "Belgeler" },
  { href: "/yonetim/sozlesmeler", label: "Sözleşmeler" },
  { href: "/yonetim/karsi-taraflar", label: "Karşı Taraflar" },
  { href: "/yonetim/gorevler", label: "Onaylar / Görevler" },
  { href: "/yonetim/bildirimler", label: "Bildirimler" },
  { href: "/yonetim/hatirlatma", label: "Hatırlatmalar" },
  { href: "/yonetim/yuklemeler", label: "Yüklemeler" },
  { href: "/yonetim/ice-aktarim", label: "İçe Aktarım" },
  { href: "/yonetim/raporlar", label: "Raporlar" },
  { href: "/yonetim/denetim", label: "Denetim" },
  { href: "/yonetim/sor", label: "Belge sorgu" },
];

const ADMIN: { href: string; label: string }[] = [
  { href: "/yonetim/kurulum", label: "Kurulum" },
  { href: "/yonetim/saklama", label: "Saklama profilleri" },
  { href: "/yonetim/imha", label: "İmha kuyruğu" },
  { href: "/yonetim/ayrilis", label: "Çalışan ayrılışı" },
  { href: "/yonetim/kirilma-cam", label: "Kırılma-cam" },
  { href: "/yonetim/guvenlik", label: "Hesap güvenliği" },
  { href: "/yonetim/entegrasyonlar", label: "Entegrasyonlar" },
];

const linkStyle = { display: "block", padding: "0.35rem 0.5rem", borderRadius: 4, color: "#0b4ea2" } as const;

export default async function YonetimLayout({ children }: { children: ReactNode }): Promise<React.JSX.Element> {
  const actor = await requireActor();
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", display: "flex", minHeight: "100vh" }}>
      <style>{".atla{position:absolute;left:-9999px;background:#fff;padding:.5rem;z-index:10}.atla:focus{position:static;left:auto}"}</style>
      <a href="#ana-icerik" className="atla">
        Ana içeriğe geç
      </a>
      <aside aria-label="Ana gezinme" style={{ width: 230, borderRight: "1px solid #d0d7de", padding: "1rem", flexShrink: 0 }}>
        <strong>EKOS EDMS</strong>
        <nav style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.15rem" }}>
          {MAIN.map((n) => (
            <Link key={n.href} href={n.href} style={linkStyle}>
              {n.label}
            </Link>
          ))}
          <Link href="/yonetim/saglik" style={linkStyle}>
            Sistem Sağlığı
          </Link>
        </nav>
        <nav aria-label="Yönetim" style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.15rem" }}>
          <span style={{ fontSize: "0.8rem", color: "#57606a", padding: "0 0.5rem" }}>Yönetim</span>
          {ADMIN.map((n) => (
            <Link key={n.href} href={n.href} style={linkStyle}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div style={{ marginTop: "2rem", fontSize: "0.8rem", color: "#57606a" }}>
          <div>Oturum açık</div>
          <div style={{ margin: "0.5rem 0" }}>
            <LogoutButton />
          </div>
        </div>
      </aside>
      <main id="ana-icerik" tabIndex={-1} style={{ flex: 1, padding: "1.5rem", minWidth: 0 }}>
        <div
          role="status"
          style={{ background: "#fff8c5", border: "1px solid #d4a72c", padding: "0.5rem 0.75rem", borderRadius: 6, marginBottom: "1.5rem", fontSize: "0.875rem" }}
        >
          Yerel kimlik modu etkin. Kurumsal SSO (Entra ID) yapılandırılmadı.
        </div>
        <p style={{ color: "#57606a", fontSize: "0.8rem" }}>Oturum: {actor.userId.slice(0, 8)}…</p>
        {children}
      </main>
    </div>
  );
}
