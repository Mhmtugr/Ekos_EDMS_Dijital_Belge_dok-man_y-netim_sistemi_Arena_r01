// Yükleme ön doğrulaması (Faz 2, madde 2). Dosya adı/MIME beyanı tek başına güvenilmez:
// içerik imzası (magic bytes) ile uyuşmalıdır. Antivirüs taraması bu fonksiyonun yerini TUTMAZ.
export const ALLOWED_TYPES = ["pdf", "png", "jpeg", "tiff", "docx", "xlsx"] as const;
export type DetectedType = (typeof ALLOWED_TYPES)[number];

export const EXPECTED_MIME: Record<DetectedType, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpeg: "image/jpeg",
  tiff: "image/tiff",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export const EXPECTED_EXTENSIONS: Record<DetectedType, readonly string[]> = {
  pdf: ["pdf"],
  png: ["png"],
  jpeg: ["jpg", "jpeg"],
  tiff: ["tif", "tiff"],
  docx: ["docx"],
  xlsx: ["xlsx"],
};

export type UploadIssue =
  | "EMPTY_FILE"
  | "SIZE_EXCEEDED"
  | "UNSUPPORTED_CONTENT"
  | "EXTENSION_MISMATCH"
  | "MIME_MISMATCH"
  | "EXECUTABLE_SIGNATURE"
  | "FILENAME_INVALID";

export interface UploadCheckInput {
  readonly filename: string;
  readonly declaredMime: string;
  readonly sizeBytes: number;
  /** Dosyanın ilk en fazla 16 baytı. */
  readonly head: Uint8Array;
  readonly maxBytes: number;
}

export type UploadCheckResult =
  | { readonly ok: true; readonly detected: DetectedType }
  | { readonly ok: false; readonly issues: UploadIssue[]; readonly detected: DetectedType | null };

const startsWith = (head: Uint8Array, bytes: readonly number[]): boolean =>
  bytes.every((b, i) => head[i] === b);

const ZIP = [0x50, 0x4b, 0x03, 0x04];

/** Çalıştırılabilir/betik imzaları — içerik ne derse desin kabul edilmez. */
const EXECUTABLE_SIGNATURES: readonly (readonly number[])[] = [
  [0x4d, 0x5a], // MZ (Windows PE)
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0xca, 0xfe, 0xba, 0xbe], // Mach-O fat / Java class
  [0x23, 0x21], // #! betik
];

export function detectType(head: Uint8Array): DetectedType | null {
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(head, [0x49, 0x49, 0x2a, 0x00]) || startsWith(head, [0x4d, 0x4d, 0x00, 0x2a])) return "tiff";
  // ZIP tabanlı Office biçimleri: iç yapı ayrımı için tam ayrıştırma gerekir; uzantı + MIME ile ayrılır.
  // Bu nedenle ZIP imzası tek başına DOCX/XLSX olarak tanınmaz (null).
  return null;
}

function isZip(head: Uint8Array): boolean {
  return startsWith(head, ZIP);
}

function extensionOf(filename: string): string | null {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return null;
  return filename.slice(dot + 1).toLowerCase();
}

export function checkUpload(input: UploadCheckInput): UploadCheckResult {
  const issues: UploadIssue[] = [];
  if (input.sizeBytes <= 0 || input.head.length === 0) issues.push("EMPTY_FILE");
  if (input.sizeBytes > input.maxBytes) issues.push("SIZE_EXCEEDED");
  let hasControl = false;
  for (let i = 0; i < input.filename.length; i++) {
    if (input.filename.charCodeAt(i) < 0x20) hasControl = true;
  }
  if (/[\\/]/.test(input.filename) || hasControl || input.filename.length > 255) {
    issues.push("FILENAME_INVALID");
  }
  if (EXECUTABLE_SIGNATURES.some((sig) => startsWith(input.head, sig))) {
    issues.push("EXECUTABLE_SIGNATURE");
  }

  let detected: DetectedType | null = detectType(input.head);
  const ext = extensionOf(input.filename);

  if (!detected && isZip(input.head) && ext !== null) {
    if (ext === "docx" || ext === "xlsx") {
      // Office dosyasını uzantıdan ayırt et; MIME'ı da bu tipe göre doğrula.
      detected = ext;
    }
  }
  if (!detected) {
    issues.push("UNSUPPORTED_CONTENT");
    return { ok: false, issues, detected: null };
  }

  const allowedExt = EXPECTED_EXTENSIONS[detected];
  if (ext === null || !allowedExt.includes(ext)) issues.push("EXTENSION_MISMATCH");
  if (input.declaredMime.toLowerCase() !== EXPECTED_MIME[detected]) issues.push("MIME_MISMATCH");

  if (issues.length > 0) return { ok: false, issues, detected };
  return { ok: true, detected };
}
