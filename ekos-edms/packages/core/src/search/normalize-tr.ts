// Türkçe arama normalizasyonu (Faz 2, madde 7). Hem indekslenen metne hem sorguya aynı fonksiyon uygulanır.
// Kural: Türkçe büyük/küçük harf (I→ı, İ→i) doğru çözülür; ardından aksan/ayrım işaretleri ASCII'ye katlanır
// (ı→i, ş→s, ğ→g, ü→u, ö→o, ç→c, â→a, î→i, û→u). Sonuç yalnızca küçük harf ASCII + rakam + boşluk olur.
const FOLD: Record<string, string> = {
  ı: "i",
  ş: "s",
  ğ: "g",
  ü: "u",
  ö: "o",
  ç: "c",
  â: "a",
  î: "i",
  û: "u",
  ê: "e",
  ô: "o",
};

export function normalizeForSearch(input: string): string {
  const nfc = input.normalize("NFC");
  // tr-TR yerel ayarı: "I" → "ı", "İ" → "i".
  const lowered = nfc.toLocaleLowerCase("tr-TR");
  let out = "";
  for (const ch of lowered) {
    out += FOLD[ch] ?? ch;
  }
  // Kalan birleşik işaretleri (combining marks) at.
  out = out.normalize("NFD").replace(/\p{M}+/gu, "").normalize("NFC");
  return out
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Sorgudaki her terim normalize edilir; boş terimler atılır. Arama her terimi AND ile eşler. */
export function normalizeQueryTerms(query: string): string[] {
  return normalizeForSearch(query)
    .split(" ")
    .filter((t) => t.length > 0);
}

/** Normalize edilmiş metinde tüm terimler varsa true (sıra bağımsız). */
export function matchesAllTerms(normalizedText: string, terms: readonly string[]): boolean {
  if (terms.length === 0) return false;
  const words = new Set(normalizedText.split(" "));
  return terms.every((t) => words.has(t));
}
