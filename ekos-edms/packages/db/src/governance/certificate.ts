// İmha tutanağı (PDF). Yalnızca içeriksiz manifestten üretilir: kimlik, özet, karar kayıtları ve fiziksel imha referansı.
// Belge içeriği, OCR metni veya arama metni YOKTUR. Manifest bütünlüğü doğrulanamazsa tutanak üretilmez.
// Harici PDF kütüphanesi yoktur: PDF 1.4, Helvetica (WinAnsi + Türkçe glif eşlemesi), standart yapı.
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { ActorContext } from "@ekos/core";
import { DomainError } from "../documents/shared.js";
import { appendAudit } from "../audit.js";
import { requireGlobal } from "./common.js";
import { verifyDisposalManifest } from "./disposal.js";

/** Türkçe karakterleri WinAnsi kodlarına eşler (Helvetica Differences ile). Desteklenmeyen karakter → '?'. */
const TR_CODES: Record<string, number> = {
  "\u011E": 0xd0, // Ğ
  "\u011F": 0xf0, // ğ
  "\u0130": 0xdd, // İ
  "\u0131": 0xfd, // ı
  "\u015E": 0xde, // Ş
  "\u015F": 0xfe, // ş
};

function encodeText(s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    const tr = TR_CODES[ch];
    if (tr !== undefined) {
      out += String.fromCharCode(tr);
    } else if (cp >= 0x20 && cp <= 0x7e) {
      out += ch;
    } else if (cp >= 0xa0 && cp <= 0xff) {
      out += ch;
    } else {
      out += "?";
    }
  }
  // PDF dize kaçışları
  return out.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

const LINES_PER_PAGE = 50;

/** Düz metin satırlarından PDF 1.4 belgesi üretir (Latin-1 bayt dizisi). */
export function buildPdf(lines: readonly string[]): Uint8Array {
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) pages.push(lines.slice(i, i + LINES_PER_PAGE));
  if (pages.length === 0) pages.push([""]);

  // Nesne numaraları: 1 Catalog, 2 Pages, 3 Font, sonra her sayfa için (içerik, sayfa).
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 5 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${String(id)} 0 R`).join(" ")}] /Count ${String(pages.length)} >>`;
  objects[3] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding " +
    "/Differences [208 /Gbreve 221 /Idotaccent 222 /Scedilla 240 /gbreve 253 /dotlessi 254 /scedilla] >> >>";
  pages.forEach((pageLines, i) => {
    const contentId = 4 + i * 2;
    const pageId = 5 + i * 2;
    const ops = ["BT", "/F1 10 Tf", "12 TL", "50 800 Td"];
    pageLines.forEach((l, idx) => {
      if (idx === 0 && i === 0) ops.push("/F1 14 Tf");
      ops.push(`(${encodeText(l)}) Tj`, "T*");
    });
    ops.push("ET");
    const content = ops.join("\n");
    objects[contentId] = `<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${String(contentId)} 0 R >>`;
  });

  const total = objects.length - 1; // nesne sayısı (1..N)
  let out = "%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n";
  const offsets: number[] = [];
  for (let id = 1; id <= total; id++) {
    const body = objects[id];
    if (body === undefined) throw new Error(`PDF nesnesi eksik: ${String(id)}`);
    offsets[id] = out.length;
    out += `${String(id)} 0 obj\n${body}\nendobj\n`;
  }
  const xrefAt = out.length;
  out += `xref\n0 ${String(total + 1)}\n0000000000 65535 f \n`;
  for (let id = 1; id <= total; id++) out += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${String(total + 1)} /Root 1 0 R >>\nstartxref\n${String(xrefAt)}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const METHOD_LABEL: Record<string, string> = {
  DIGITAL_DELETE: "Dijital silme",
  PHYSICAL_DESTRUCTION_RECORD: "Fiziksel imha (ayrı kanıt kaydı)",
};

/** Manifest alanlarından tutanak satırları. Yalnızca içeriksiz alanlar kullanılır. */
export function certificateLines(m: Record<string, unknown>, manifestSha256: string): string[] {
  const s = (k: string): string => {
    const v = m[k];
    if (v === null || v === undefined) return "—";
    if (typeof v === "object") return JSON.stringify(v);
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
    return "—";
  };
  const lines: string[] = [
    "EKOS EDMS - IMHA TUTANAGI",
    "",
    `Tutanak (inceleme) kimligi : ${s("reviewId")}`,
    `Belge kimligi              : ${s("documentId")}`,
    `Belge numarasi             : ${s("documentNumber")}`,
    `Belge turu                 : ${s("documentTypeCode")}`,
    "",
    `Saklama profili            : ${s("retentionProfileCode")}`,
    `Politika surumu            : ${s("policyVersionNumber")}`,
    `Baslangic olayi            : ${s("startEvent")}`,
    `Baslangic tarihi           : ${s("startDate")}`,
    `Vade (son saklama tarihi)  : ${s("dueDate")}`,
    `Imha yontemi               : ${METHOD_LABEL[s("disposalMethod")] ?? s("disposalMethod")}`,
    `Fiziksel imha kanit ref.   : ${s("physicalEvidenceRef") === "—" ? "Yok (dijital imha)" : s("physicalEvidenceRef")}`,
    "",
    "Surumler (icerik ozeti, SHA-256):",
  ];
  const versions = Array.isArray(m.versions) ? (m.versions as Record<string, unknown>[]) : [];
  if (versions.length === 0) lines.push("  (sürüm yok)");
  for (const v of versions) {
    lines.push(`  v${String(v.versionNumber)}  ${String(v.sha256)}`);
  }
  lines.push("", "Onaylar (rol, karar, zaman):");
  const approvals = Array.isArray(m.approvals) ? (m.approvals as Record<string, unknown>[]) : [];
  if (approvals.length === 0) lines.push("  (karar yok)");
  for (const a of approvals) {
    lines.push(`  ${String(a.role)}  ${String(a.decision)}  ${String(a.decidedAt)}  onaylayan: ${String(a.actorId)}`);
  }
  lines.push("", `Yurutme zamani            : ${s("executedAt")}`, `Sonuc                      : ${s("result")}`);
  lines.push(`Arama dizini               : ${s("searchIndex")}`);
  lines.push("", `Manifest SHA-256            : ${manifestSha256}`, "");
  lines.push("Bu tutanak belge icerigi, OCR metni veya arama metni icermez.");
  lines.push("Fiziksel imha kaydi dijital tutanaktan ayridir; yalnizca referans olarak yer alir.");
  return lines;
}

/** İmha tutanağı üretir (config.manage). Yalnızca YÜRÜTÜLMÜŞ imha için. Denetime yazılır. */
export async function buildDisposalCertificate(
  prisma: PrismaClient,
  input: { actor: ActorContext; now: Date; correlationId: string; reviewId: string },
): Promise<{ filename: string; bytes: Uint8Array; sha256: string }> {
  requireGlobal(input.actor, "config.manage", input.now);
  const row = await prisma.disposalManifest.findUnique({ where: { reviewId: input.reviewId } });
  if (!row) throw new DomainError("NOT_FOUND");
  if (!verifyDisposalManifest({ manifest: row.manifest, manifestSha256: row.manifestSha256 })) {
    throw new DomainError("INTEGRITY_MISMATCH", "Manifest bütünlüğü doğrulanamadı; tutanak üretilmedi");
  }
  const m = row.manifest as Record<string, unknown>;
  const bytes = buildPdf(certificateLines(m, row.manifestSha256));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await prisma.$transaction(async (tx) => {
    await appendAudit(tx, {
      actorType: "USER", actorId: input.actor.userId, eventType: "DISPOSAL_CERTIFICATE_EXPORTED", targetType: "DISPOSAL_REVIEW",
      targetId: input.reviewId, outcome: "SUCCESS", correlationId: input.correlationId,
      afterSummary: { manifestSha256: row.manifestSha256, certificateSha256: sha256 },
    });
  });
  return { filename: `imha-tutanagi-${input.reviewId}.pdf`, bytes, sha256 };
}

/** Yürütülmüş imhaların listesi (config.manage). Yalnızca içeriksiz manifest alanları. */
export async function listExecutedDispositions(prisma: PrismaClient, input: { actor: ActorContext; now: Date }) {
  requireGlobal(input.actor, "config.manage", input.now);
  const rows = await prisma.disposalManifest.findMany({ orderBy: { executedAt: "desc" }, take: 200 });
  return rows.map((r) => {
    const m = r.manifest as Record<string, unknown>;
    return {
      reviewId: r.reviewId,
      documentNumber: typeof m.documentNumber === "string" ? m.documentNumber : null,
      executedAt: r.executedAt,
      manifestSha256: r.manifestSha256,
      physicalEvidenceRef: r.physicalEvidenceRef,
    };
  });
}
