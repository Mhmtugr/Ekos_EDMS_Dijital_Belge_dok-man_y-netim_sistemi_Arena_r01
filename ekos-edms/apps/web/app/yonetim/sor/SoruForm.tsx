"use client";
// Belge soru-cevap formu. Yanıt yalnız sunucudan gelen doğrulanmış biçimi gösterir; AI kapalıysa yalnız kaynak pasajlar.
import { useState } from "react";

type Source = { documentId: string; documentNumber: string; title: string; page: number; snippet: string };
type Result =
  | { status: "ANSWERED"; answer: string; sources: Source[] }
  | { status: "NOT_FOUND"; answer: string; sources: [] }
  | { status: "PASSAGES_ONLY"; reason: string; sources: Source[] };

const REASON_TEXT: Record<string, string> = {
  AI_NOT_CONFIGURED: "Yapay zekâ özelliği etkin değil; yalnızca ilgili kaynak pasajlar gösteriliyor.",
  AI_UNAVAILABLE: "Yapay zekâ servisi yanıt veremedi; yalnızca ilgili kaynak pasajlar gösteriliyor.",
  AI_NOT_APPROVED_FOR_TYPE: "Bu belge türü dış yapay zekâya gönderilmek üzere onaylanmamış; yalnızca kaynak pasajlar gösteriliyor.",
};

export function SoruForm(): React.JSX.Element {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function onSubmit(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const body = (await res.json()) as Result & { code?: string };
      if (!res.ok) {
        setError(res.status === 429 ? "Çok fazla sorgu. Lütfen bir dakika sonra tekrar deneyin." : "Sorgu yapılamadı. Lütfen tekrar deneyin.");
        return;
      }
      setResult(body);
    } catch {
      setError("Sunucuya ulaşılamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <form onSubmit={(e) => void onSubmit(e)} style={{ display: "flex", gap: "0.5rem", alignItems: "end", flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", flex: "1 1 360px" }}>
          Soru
          <input
            name="question"
            value={question}
            maxLength={500}
            required
            onChange={(e) => { setQuestion(e.target.value); }}
            placeholder="Örn. kira bedeli ne zaman ödenir?"
            style={{ padding: "0.5rem", marginTop: "0.25rem" }}
          />
        </label>
        <button type="submit" disabled={busy || question.trim().length === 0} style={{ padding: "0.5rem 1rem" }}>
          {busy ? "Aranıyor…" : "Sor"}
        </button>
      </form>

      {error !== null && (
        <p role="alert" style={{ color: "#b42318", marginTop: "1rem" }}>
          {error}
        </p>
      )}

      {result?.status === "ANSWERED" && (
        <section aria-label="Yanıt" style={{ marginTop: "1.5rem" }}>
          <h2>Yanıt</h2>
          <p>{result.answer}</p>
          <SourceList sources={result.sources} />
        </section>
      )}

      {result?.status === "NOT_FOUND" && (
        <section aria-label="Yanıt" style={{ marginTop: "1.5rem" }}>
          <p>Belgede doğrulanabilir bilgi bulunamadı.</p>
        </section>
      )}

      {result?.status === "PASSAGES_ONLY" && (
        <section aria-label="Kaynak pasajlar" style={{ marginTop: "1.5rem" }}>
          <p>{REASON_TEXT[result.reason] ?? "Yalnızca kaynak pasajlar gösteriliyor."}</p>
          <SourceList sources={result.sources} />
        </section>
      )}
    </div>
  );
}

function SourceList({ sources }: { sources: Source[] }): React.JSX.Element | null {
  if (sources.length === 0) return null;
  return (
    <ul style={{ marginTop: "0.75rem", paddingLeft: "1.25rem" }}>
      {sources.map((s, i) => (
        <li key={`${s.documentId}-${String(s.page)}-${String(i)}`} style={{ marginBottom: "0.75rem" }}>
          <strong>{s.title}</strong> <span>({s.documentNumber}, sayfa {s.page})</span>
          <div style={{ color: "#444" }}>“{s.snippet}”</div>
        </li>
      ))}
    </ul>
  );
}
