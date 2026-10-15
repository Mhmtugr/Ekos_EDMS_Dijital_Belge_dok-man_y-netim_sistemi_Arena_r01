// Toplu içe aktarım manifesti (Faz 2, madde 9). CSV (RFC 4180) ayrıştırma ve satır bazlı doğrulama.
// Hatalı satır SESSİZCE ATLANMAZ: her hata satır ve kod ile raporlanır. İçe aktarma yeniden başlatılabilir:
// işlenmiş son satır numarası verilirse yalnızca kalan satırlar planlanır.
export interface ParsedCsv {
  readonly headers: readonly string[];
  readonly rows: readonly { readonly line: number; readonly cells: readonly string[] }[];
  readonly parseErrors: readonly { readonly line: number; readonly message: string }[];
}

export function parseCsv(text: string): ParsedCsv {
  const src = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const records: { line: number; cells: string[] }[] = [];
  const parseErrors: { line: number; message: string }[] = [];
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let i = 0;

  const endField = (): void => {
    cells.push(field);
    field = "";
  };
  const endRecord = (): void => {
    endField();
    if (!(cells.length === 1 && cells[0] === "")) records.push({ line: recordLine, cells });
    cells = [];
  };

  while (i < src.length) {
    const ch = src[i] ?? "";
    // Yeni kayıt başlıyorsa satır numarası o anki satırdır (hata raporu için).
    if (cells.length === 0 && field.length === 0 && !inQuotes) recordLine = line;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      if (ch === "\n") line++;
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      if (field.length > 0) parseErrors.push({ line, message: "Alan ortasında çift tırnak" });
      inQuotes = true;
      i++;
    } else if (ch === ",") {
      endField();
      i++;
    } else if (ch === "\r" && src[i + 1] === "\n") {
      endRecord();
      line++;
      i += 2;
    } else if (ch === "\n") {
      endRecord();
      line++;
      i++;
    } else {
      field += ch;
      i++;
    }
  }
  if (inQuotes) parseErrors.push({ line: recordLine, message: "Kapanmamış tırnak" });
  if (field.length > 0 || cells.length > 0) endRecord();

  const [header, ...body] = records;
  if (!header) return { headers: [], rows: [], parseErrors: [{ line: 1, message: "Başlık satırı yok" }] };
  return {
    headers: header.cells.map((h) => h.trim()),
    rows: body.map((r) => ({ line: r.line, cells: r.cells })),
    parseErrors,
  };
}

export const MANIFEST_REQUIRED_COLUMNS = ["fileName", "documentTypeCode", "title", "documentDate"] as const;

export type ManifestErrorCode =
  | "MISSING_COLUMN"
  | "COLUMN_COUNT_MISMATCH"
  | "REQUIRED_FIELD_EMPTY"
  | "DATE_INVALID"
  | "DUPLICATE_FILE_NAME_IN_MANIFEST"
  | "PARSE_ERROR";

export interface ManifestRowError {
  readonly line: number;
  readonly code: ManifestErrorCode;
  readonly column?: string;
  readonly message: string;
}

export interface ManifestRow {
  readonly line: number;
  readonly fileName: string;
  readonly documentTypeCode: string;
  readonly title: string;
  readonly documentDate: string;
}

export interface ManifestValidation {
  readonly valid: readonly ManifestRow[];
  readonly errors: readonly ManifestRowError[];
  readonly summary: { readonly total: number; readonly valid: number; readonly invalid: number };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function validateManifest(csv: ParsedCsv): ManifestValidation {
  const errors: ManifestRowError[] = csv.parseErrors.map((e) => ({
    line: e.line,
    code: "PARSE_ERROR" as const,
    message: e.message,
  }));
  const missing = MANIFEST_REQUIRED_COLUMNS.filter((c) => !csv.headers.includes(c));
  for (const c of missing) {
    errors.push({ line: 1, code: "MISSING_COLUMN", column: c, message: `Zorunlu sütun yok: ${c}` });
  }
  if (missing.length > 0) {
    return { valid: [], errors, summary: { total: csv.rows.length, valid: 0, invalid: csv.rows.length } };
  }

  const idx = (name: string): number => csv.headers.indexOf(name);
  const seenFiles = new Map<string, number>();
  const valid: ManifestRow[] = [];
  const badLines = new Set<number>();

  for (const row of csv.rows) {
    if (row.cells.length !== csv.headers.length) {
      errors.push({
        line: row.line,
        code: "COLUMN_COUNT_MISMATCH",
        message: `Sütun sayısı ${String(row.cells.length)}, beklenen ${String(csv.headers.length)}`,
      });
      badLines.add(row.line);
      continue;
    }
    const get = (c: string): string => (row.cells[idx(c)] ?? "").trim();
    let rowBad = false;
    for (const c of MANIFEST_REQUIRED_COLUMNS) {
      if (get(c) === "") {
        errors.push({ line: row.line, code: "REQUIRED_FIELD_EMPTY", column: c, message: `Boş alan: ${c}` });
        rowBad = true;
      }
    }
    const date = get("documentDate");
    if (date !== "" && !isRealDate(date)) {
      errors.push({ line: row.line, code: "DATE_INVALID", column: "documentDate", message: "Tarih YYYY-MM-DD olmalı" });
      rowBad = true;
    }
    const fileName = get("fileName");
    if (fileName !== "") {
      const first = seenFiles.get(fileName);
      if (first !== undefined) {
        errors.push({
          line: row.line,
          code: "DUPLICATE_FILE_NAME_IN_MANIFEST",
          column: "fileName",
          message: `Aynı dosya adı manifestte satır ${String(first)}'de de var`,
        });
        rowBad = true;
      } else {
        seenFiles.set(fileName, row.line);
      }
    }
    if (rowBad) {
      badLines.add(row.line);
      continue;
    }
    valid.push({
      line: row.line,
      fileName,
      documentTypeCode: get("documentTypeCode"),
      title: get("title"),
      documentDate: date,
    });
  }

  const total = csv.rows.length;
  return {
    valid,
    errors,
    summary: { total, valid: valid.length, invalid: badLines.size },
  };
}

/** Yeniden başlatma: `lastCommittedLine` dahil olmak üzere işlenmiş satırları atlar. */
export function remainingRows(rows: readonly ManifestRow[], lastCommittedLine: number | null): ManifestRow[] {
  if (lastCommittedLine === null) return [...rows];
  return rows.filter((r) => r.line > lastCommittedLine);
}
