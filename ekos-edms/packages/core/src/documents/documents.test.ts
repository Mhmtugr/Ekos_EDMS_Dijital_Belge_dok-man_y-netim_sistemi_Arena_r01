import { describe, expect, it } from "vitest";
import { BASE_DOCUMENT_TYPES, findBaseType, validateDocumentTypeChange } from "./catalog.js";
import { checkUpload } from "./upload-validation.js";
import { INITIAL_INGEST, IllegalIngestTransition, isPublishable, transitionIngest, type IngestState } from "./ingest.js";
import { detectDuplicates, sha256Hex } from "./hash-duplicates.js";
import { VERSION_PHYSICAL_DELETE_ALLOWED, checkVersionPatch, compareVersionMetadata, createNewVersion, type VersionRecord } from "./versioning.js";
import { decideDocumentAccess } from "./access.js";
import { checkRowVersion } from "../concurrency/row-version.js";
import { parseCsv, remainingRows, validateManifest } from "../import/manifest.js";
import { matchesAllTerms, normalizeForSearch, normalizeQueryTerms } from "../search/normalize-tr.js";
import type { ActorContext, ResourceRef } from "../authz/authorize.js";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const PDF_HEAD = enc("%PDF-1.7\n");
const PNG_HEAD = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const ZIP_HEAD = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0]);
const MAX = 10 * 1024 * 1024;

describe("belge türü kataloğu", () => {
  it("16 başlangıç şablonu ve benzersiz kodlar", () => {
    expect(BASE_DOCUMENT_TYPES).toHaveLength(16);
    expect(new Set(BASE_DOCUMENT_TYPES.map((t) => t.code)).size).toBe(16);
  });

  it("İK belgesi varsayılan olarak HIGHLY_RESTRICTED", () => {
    expect(findBaseType("HR_DOCUMENT")?.minConfidentiality).toBe("HIGHLY_RESTRICTED");
  });

  it("şablonların tamamı geçerlidir", () => {
    for (const t of BASE_DOCUMENT_TYPES) expect(validateDocumentTypeChange(t), t.code).toEqual([]);
  });

  it("gizlilik şablon minimumunun altına indirilemez", () => {
    const hr = findBaseType("HR_DOCUMENT");
    if (!hr) throw new Error("HR şablonu yok");
    const weaker = { ...hr, minConfidentiality: "INTERNAL" as const };
    expect(validateDocumentTypeChange(weaker, hr)).toContain("CONFIDENTIALITY_BELOW_TEMPLATE_MINIMUM");
  });

  it("saklama profili kaldırılamaz ve zorunlu metadata eksik bırakılamaz", () => {
  
    const base = BASE_DOCUMENT_TYPES[0];
    if (!base) throw new Error("şablon yok");
    const bad = { ...base, retentionProfileRef: null, requiredMetadata: ["title"] };
    const v = validateDocumentTypeChange(bad);
    expect(v).toContain("RETENTION_PROFILE_MISSING");
    expect(v).toContain("REQUIRED_METADATA_INCOMPLETE");
  });

  it("OCR zorunlu türde kapatılamaz; geçersiz kod reddedilir", () => {
    const sup = findBaseType("SUPPLIER_CONTRACT");
    if (!sup) throw new Error();
    expect(validateDocumentTypeChange({ ...sup, ocrRequired: false }, sup)).toContain("OCR_DISABLED_FOR_REQUIRED_TYPE");
    expect(validateDocumentTypeChange({ ...sup, code: "bad code" })).toContain("CODE_INVALID");
  });
});

describe("yükleme doğrulaması", () => {
  it("geçerli PDF kabul edilir", () => {
    const r = checkUpload({ filename: "sozlesme.pdf", declaredMime: "application/pdf", sizeBytes: 100, head: PDF_HEAD, maxBytes: MAX });
    expect(r).toEqual({ ok: true, detected: "pdf" });
  });

  it("uzantısı PDF ama içeriği PNG olan dosya reddedilir (MIME/uzantı sahteciliği)", () => {
    const r = checkUpload({ filename: "x.pdf", declaredMime: "application/pdf", sizeBytes: 100, head: PNG_HEAD, maxBytes: MAX });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toContain("EXTENSION_MISMATCH");
  });

  it("yanlış beyan edilen MIME reddedilir", () => {
    const r = checkUpload({ filename: "a.png", declaredMime: "image/jpeg", sizeBytes: 100, head: PNG_HEAD, maxBytes: MAX });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toContain("MIME_MISMATCH");
  });

  it("boyut aşımı reddedilir", () => {
    const r = checkUpload({ filename: "a.pdf", declaredMime: "application/pdf", sizeBytes: MAX + 1, head: PDF_HEAD, maxBytes: MAX });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toContain("SIZE_EXCEEDED");
  });

  it("boş dosya reddedilir", () => {
    const r = checkUpload({ filename: "a.pdf", declaredMime: "application/pdf", sizeBytes: 0, head: new Uint8Array(), maxBytes: MAX });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toContain("EMPTY_FILE");
  });

  it("Windows çalıştırılabilir dosya (MZ) — uzantı .pdf olsa bile reddedilir", () => {
    const mz = Uint8Array.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]);
    const r = checkUpload({ filename: "fatura.pdf", declaredMime: "application/pdf", sizeBytes: 100, head: mz, maxBytes: MAX });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toContain("EXECUTABLE_SIGNATURE");
  });

  it("tanınmayan içerik reddedilir", () => {
    const r = checkUpload({ filename: "a.txt", declaredMime: "text/plain", sizeBytes: 5, head: enc("merhaba"), maxBytes: MAX });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toContain("UNSUPPORTED_CONTENT");
  });

  it("ZIP imzası DOCX uzantısı olmadan kabul edilmez; .docx ile kabul edilir", () => {
    const docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect(checkUpload({ filename: "a.docx", declaredMime: docxMime, sizeBytes: 9, head: ZIP_HEAD, maxBytes: MAX }).ok).toBe(true);
    expect(checkUpload({ filename: "a.zip", declaredMime: "application/zip", sizeBytes: 9, head: ZIP_HEAD, maxBytes: MAX }).ok).toBe(false);
  });

  it("geçersiz dosya adı (yol karakteri) reddedilir", () => {
    const r = checkUpload({ filename: "../../etc.pdf", declaredMime: "application/pdf", sizeBytes: 9, head: PDF_HEAD, maxBytes: MAX });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toContain("FILENAME_INVALID");
  });
});

describe("ingest durum makinesi", () => {
  it("tarama temiz → işleme; bulaşmış → REJECTED", () => {
    expect(transitionIngest(INITIAL_INGEST, "SCAN_CLEAN").status).toBe("PROCESSING");
    expect(transitionIngest(INITIAL_INGEST, "SCAN_INFECTED").status).toBe("REJECTED");
  });

  it("tarama servisi kapalıyken karantinada kalır, READY olmaz", () => {
    const s = transitionIngest(INITIAL_INGEST, "SCAN_UNAVAILABLE");
    expect(s.status).toBe("QUARANTINED");
    expect(isPublishable(s)).toBe(false);
    expect(() => transitionIngest(s, "OCR_SUCCEEDED")).toThrow(IllegalIngestTransition);
  });

  it("OCR başarısızlığı FAILED_RETRYABLE; yeniden deneme sınırı dolunca READY'ye geçmez", () => {
    let s: IngestState = transitionIngest(INITIAL_INGEST, "SCAN_CLEAN");
    for (let i = 0; i < 3; i++) {
      s = transitionIngest(s, "OCR_STARTED");
      s = transitionIngest(s, "OCR_FAILED_TRANSIENT");
      expect(s.status).toBe("FAILED_RETRYABLE");
      if (i < 2) s = transitionIngest(s, "RETRY_REQUESTED");
    }
    expect(transitionIngest(s, "RETRY_REQUESTED").status).toBe("FAILED_RETRYABLE");
    expect(isPublishable(s)).toBe(false);
  });

  it("OCR gerektirmeyen tür PROCESSING'den METADATA_PENDING'e geçer", () => {
    const s = transitionIngest(INITIAL_INGEST, "SCAN_CLEAN");
    expect(transitionIngest(s, "OCR_NOT_REQUIRED").status).toBe("METADATA_PENDING");
  });

  it("kalıcı OCR hatası FAILED_RETRYABLE'da kalır ve yeniden denemeye kapalıdır", () => {
    let s = transitionIngest(INITIAL_INGEST, "SCAN_CLEAN");
    s = transitionIngest(s, "OCR_STARTED");
    s = transitionIngest(s, "OCR_FAILED_FINAL");
    expect(s.status).toBe("FAILED_RETRYABLE");
    expect(transitionIngest(s, "RETRY_REQUESTED").status).toBe("FAILED_RETRYABLE");
    expect(isPublishable(s)).toBe(false);
  });

  it("tam akış READY'ye varır; READY ve REJECTED terminaldir", () => {
    let s = transitionIngest(INITIAL_INGEST, "SCAN_CLEAN");
    s = transitionIngest(s, "OCR_STARTED");
    s = transitionIngest(s, "OCR_SUCCEEDED");
    expect(s.status).toBe("METADATA_PENDING");
    s = transitionIngest(s, "METADATA_COMPLETED");
    expect(isPublishable(s)).toBe(true);
    expect(() => transitionIngest(s, "SCAN_CLEAN")).toThrow();
    expect(() => transitionIngest({ status: "REJECTED", ocrAttempts: 0 }, "SCAN_CLEAN")).toThrow();
  });
});

describe("kopya tespiti", () => {
  const base = { title: "Tedarik Sözleşmesi", documentTypeId: "t1", counterpartyId: "c1", documentDate: "2026-03-01" };
  it("birebir SHA-256 eşleşmesi exact olarak raporlanır, engellemez", () => {
    const hash = sha256Hex(enc("içerik"));
    const r = detectDuplicates({ ...base, sha256: hash }, [
      { documentId: "d1", sha256: hash, title: "X", documentTypeId: "t9", counterpartyId: null, documentDate: null },
    ]);
    expect(r.exactDuplicateIds).toEqual(["d1"]);
    expect(r.blocking).toBe(false);
  });

  it("metadata benzerliği yalnızca uyarıdır (farklı hash)", () => {
    const r = detectDuplicates({ ...base, sha256: "a".repeat(64) }, [
      { documentId: "d2", sha256: "b".repeat(64), title: "tedarik sozlesmesi", documentTypeId: "t1", counterpartyId: "c1", documentDate: "2026-03-01" },
    ]);
    expect(r.exactDuplicateIds).toEqual([]);
    expect(r.similarMetadataIds).toEqual(["d2"]);
  });
});

describe("sürümleme", () => {
  const v1: VersionRecord = { id: "v1", documentId: "doc", versionNumber: 1, sha256: "a".repeat(64), fileObjectId: "f1", isSigned: false, isReadOnly: false, previousVersionId: null };

  it("yeni içerik yeni sürüm üretir ve önceki sürüm salt-okunur kilitlenir", () => {
    const { next, lockedPrevious } = createNewVersion(v1, { id: "v2", sha256: "b".repeat(64), fileObjectId: "f2", reason: "Revize" });
    expect(next.versionNumber).toBe(2);
    expect(next.previousVersionId).toBe("v1");
    expect(lockedPrevious.isReadOnly).toBe(true);
    expect(v1.isReadOnly).toBe(false); // girdi değişmez
  });

  it("gerekçe olmadan yeni sürüm üretilemez", () => {
    expect(() => createNewVersion(v1, { id: "v2", sha256: "b".repeat(64), fileObjectId: "f2", reason: "  " })).toThrow();
  });

  it("salt-okunur sürümün içeriği değiştirilemez ve silinemez", () => {
    const ro = { ...v1, isReadOnly: true };
    expect(checkVersionPatch(ro, { sha256: "c".repeat(64) })).toEqual({ code: "VERSION_READ_ONLY" });
    expect(checkVersionPatch(ro, {})).toEqual({ code: "VERSION_READ_ONLY" });
    expect(VERSION_PHYSICAL_DELETE_ALLOWED).toBe(false);
  });

  it("değişmez alan (versionNumber) yazma denemesi reddedilir", () => {
    expect(checkVersionPatch(v1, { versionNumber: 9 })).toEqual({ code: "IMMUTABLE_FIELD", field: "versionNumber" });
  });

  it("karşılaştırma meta farklarını döner", () => {
    const { next } = createNewVersion(v1, { id: "v2", sha256: "b".repeat(64), fileObjectId: "f2", reason: "x" });
    expect(compareVersionMetadata(v1, next).map((d) => d.field)).toContain("sha256");
  });
});

describe("Türkçe arama normalizasyonu", () => {
  it.each([
    ["İSTANBUL", "istanbul"],
    ["ıstanbul", "istanbul"],
    ["Şirket Ünvanı", "sirket unvani"],
    ["GÜÇ ÖZELLİĞİ", "guc ozelligi"],
    ["Çağrı Ağı", "cagri agi"],
    ["Doğru-Kayıt/No 42", "dogru kayit no 42"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeForSearch(input)).toBe(expected);
  });

  it("sorgu ve metin aynı şekilde normalize olur: 'sirket' ile 'Şirket' eşleşir", () => {
    const text = normalizeForSearch("Tedarikçi Şirket Sözleşmesi");
    expect(matchesAllTerms(text, normalizeQueryTerms("ŞİRKET sozlesmesi"))).toBe(true);
    expect(matchesAllTerms(text, normalizeQueryTerms("sirket fatura"))).toBe(false);
  });

  it("boş sorgu eşleşme üretmez", () => {
    expect(matchesAllTerms("abc", normalizeQueryTerms("   "))).toBe(false);
  });
});

describe("toplu içe aktarım manifesti", () => {
  const header = "fileName,documentTypeCode,title,documentDate";

  it("CSV tırnak, kaçış ve CRLF'yi doğru ayrıştırır", () => {
    const csv = parseCsv(`\uFEFF${header}\r\na.pdf,NDA,"Gizlilik, ""Ek"" 1",2026-01-02\r\n`);
    expect(csv.headers).toEqual(["fileName", "documentTypeCode", "title", "documentDate"]);
    expect(csv.rows[0]?.cells[2]).toBe('Gizlilik, "Ek" 1');
  });

  it("hatalı satırlar sessizce atlanmaz, satır numarasıyla raporlanır", () => {
    const text = [
      header,
      "a.pdf,NDA,Başlık A,2026-01-02",
      "b.pdf,,Başlık B,2026-01-02",
      "c.pdf,NDA,Başlık C,2026-02-30",
      "a.pdf,NDA,Başlık D,2026-01-03",
      "d.pdf,NDA,Başlık E",
    ].join("\n");
    const v = validateManifest(parseCsv(text));
    expect(v.summary).toEqual({ total: 5, valid: 1, invalid: 4 });
    const codes = v.errors.map((e) => `${String(e.line)}:${e.code}`);
    expect(codes).toContain("3:REQUIRED_FIELD_EMPTY");
    expect(codes).toContain("4:DATE_INVALID");
    expect(codes).toContain("5:DUPLICATE_FILE_NAME_IN_MANIFEST");
    expect(codes).toContain("6:COLUMN_COUNT_MISMATCH");
  });

  it("eksik zorunlu sütun tüm satırları reddeder", () => {
    const v = validateManifest(parseCsv("fileName,title\na.pdf,x"));
    expect(v.errors.some((e) => e.code === "MISSING_COLUMN" && e.column === "documentTypeCode")).toBe(true);
    expect(v.valid).toHaveLength(0);
  });

  it("yeniden başlatma yalnızca işlenmemiş satırları planlar", () => {
    const v = validateManifest(parseCsv([header, "a.pdf,NDA,A,2026-01-01", "b.pdf,NDA,B,2026-01-01", "c.pdf,NDA,C,2026-01-01"].join("\n")));
    // Veri satırları 2,3,4 (başlık 1). lastCommittedLine=3 → yalnızca 4. satır kalır.
    expect(remainingRows(v.valid, 3).map((r) => r.fileName)).toEqual(["c.pdf"]);
    expect(remainingRows(v.valid, 2).map((r) => r.fileName)).toEqual(["b.pdf", "c.pdf"]);
    expect(remainingRows(v.valid, null)).toHaveLength(3);
  });
});

describe("rowVersion (409)", () => {
  it("eşleşen sürüm kabul edilir ve artar", () => {
    expect(checkRowVersion(4, 4)).toEqual({ ok: true, nextRowVersion: 5 });
  });
  it("eski sürümle yazma 409 VERSION_CONFLICT", () => {
    expect(checkRowVersion(5, 4)).toEqual({ ok: false, status: 409, code: "VERSION_CONFLICT" });
  });
});

describe("belge erişimi (IDOR, 404/403)", () => {
  const doc: ResourceRef = { id: "doc-1", kind: "DOCUMENT", departmentId: "dep-hr", documentTypeId: "HR_DOCUMENT", confidentiality: "HIGHLY_RESTRICTED" };
  const now = new Date("2026-10-13T09:00:00Z");
  const stranger: ActorContext = { userId: "u-x", status: "ACTIVE", groupIds: [], memberships: [], breakGlass: [] };
  const pyAdmin: ActorContext = {
    userId: "u-py",
    status: "ACTIVE",
    groupIds: [],
    memberships: [{ membershipId: "m1", roleCode: "PLATFORM_ADMIN", permissions: ["user.manage", "role.manage", "config.manage", "integration.manage", "system.health"], scope: {} }],
    breakGlass: [],
  };
  const viewerOtherDept: ActorContext = {
    userId: "u-v",
    status: "ACTIVE",
    groupIds: [],
    memberships: [{ membershipId: "m2", roleCode: "DEPARTMENT_USER", permissions: ["document.view_metadata", "document.preview", "document.list"], scope: { departmentIds: ["dep-sales"] } }],
    breakGlass: [],
  };

  it("hiç yetkisi olmayan kullanıcı belgeyi göremez: 404 (varlık sızmaz)", () => {
    const d = decideDocumentAccess({ actor: stranger, resource: doc, now }, "download");
    expect(d).toEqual({ allowed: false, status: 404 });
  });

  it("belge ID'si tahmin edilse bile yetkisiz kullanıcı önizleme ve OCR metni alamaz", () => {
    expect(decideDocumentAccess({ actor: stranger, resource: doc, now }, "preview").allowed).toBe(false);
    expect(decideDocumentAccess({ actor: stranger, resource: doc, now }, "ocr_text").allowed).toBe(false);
  });

  it("Platform Yöneticisi belge içeriğine erişemez (ne görünürlük ne eylem)", () => {
    expect(decideDocumentAccess({ actor: pyAdmin, resource: doc, now }, "view_metadata").allowed).toBe(false);
    expect(decideDocumentAccess({ actor: pyAdmin, resource: doc, now }, "download")).toEqual({ allowed: false, status: 404 });
  });

  it("farklı departman kapsamındaki kullanıcı: 404; kapsam içindeyse eylem izni ayrı kontrol edilir", () => {
    expect(decideDocumentAccess({ actor: viewerOtherDept, resource: doc, now }, "preview")).toEqual({ allowed: false, status: 404 });
    const inScope: ResourceRef = { ...doc, departmentId: "dep-sales", documentTypeId: "PURCHASE_ORDER", confidentiality: "INTERNAL" };
    // Görünür ama indirme izni yok → 403
    expect(decideDocumentAccess({ actor: viewerOtherDept, resource: inScope, now }, "download")).toEqual({ allowed: false, status: 403 });
    expect(decideDocumentAccess({ actor: viewerOtherDept, resource: inScope, now }, "preview").allowed).toBe(true);
  });
});

import { UUID_V7_RE, uuidv7 } from "../ids.js";
describe("UUIDv7", () => {
  it("biçim ve sürüm doğru", () => {
    for (let i = 0; i < 200; i++) expect(uuidv7()).toMatch(UUID_V7_RE);
  });
  it("aynı milisaniyede bile benzersiz", () => {
    const set = new Set(Array.from({ length: 5000 }, () => uuidv7(1_700_000_000_000)));
    expect(set.size).toBe(5000);
  });
  it("zaman sırası korunur (ilk 48 bit)", () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a < b).toBe(true);
  });
});
