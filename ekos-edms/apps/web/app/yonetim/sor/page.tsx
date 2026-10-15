// Belge soru-cevap ekranı (Faz 6 madde 4). Yetki sunucuda SQL içinde uygulanır; bu ekran yalnız formu gösterir.
import { SoruForm } from "./SoruForm";

export default function SorPage(): React.JSX.Element {
  return (
    <section>
      <h1>Belge sorgu</h1>
      <p style={{ color: "#444" }}>
        Yalnızca erişim yetkiniz olan belgeler taranır. Yanıtlar kaynak belge ve sayfa ile verilir; kaynak yoksa yanıt verilmez.
      </p>
      <div style={{ marginTop: "1rem" }}>
        <SoruForm />
      </div>
    </section>
  );
}
