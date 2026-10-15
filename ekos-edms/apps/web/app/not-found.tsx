// Bulunamadı sayfası. Varlık sızdırmaz: var olmayan ve yetkisiz kayıtlar aynı biçimde görünür.
export default function NotFound(): React.JSX.Element {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>Sayfa bulunamadı</h1>
      <p>Aradığınız sayfa mevcut değil veya erişim yetkiniz yok.</p>
    </main>
  );
}
