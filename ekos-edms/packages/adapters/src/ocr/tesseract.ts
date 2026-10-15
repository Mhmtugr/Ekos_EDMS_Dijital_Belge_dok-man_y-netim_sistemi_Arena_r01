// Tesseract CLI sarmalayıcı (yalnızca görüntü türleri). PDF OCR için ocrmypdf/rasterizasyon henüz bağlı DEĞİL:
// PDF isteği FAILED/FINAL döner; uydurma metin üretilmez.
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OcrOutcome, OcrPort } from "@ekos/core";

const IMAGE_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/tiff": "tif" };

/** Tesseract TSV çıktısını sayfa sonucuna çevirir. Kelime satırları level=5'tir. */
export function parseTesseractTsv(tsv: string): { text: string; confidence: number } | null {
  const lines = tsv.split("\n");
  const header = lines[0]?.split("\t");
  if (!header) return null;
  const idxConf = header.indexOf("conf");
  const idxText = header.indexOf("text");
  const idxLevel = header.indexOf("level");
  if (idxConf < 0 || idxText < 0 || idxLevel < 0) return null;
  const words: string[] = [];
  const confs: number[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split("\t");
    if (cols[idxLevel] !== "5") continue;
    const text = (cols[idxText] ?? "").trim();
    const conf = Number(cols[idxConf]);
    if (text === "" || !Number.isFinite(conf) || conf < 0) continue;
    words.push(text);
    confs.push(conf);
  }
  if (words.length === 0) return { text: "", confidence: 0 };
  const avg = confs.reduce((a, b) => a + b, 0) / confs.length;
  return { text: words.join(" "), confidence: Math.round((avg / 100) * 10000) / 10000 };
}

export interface TesseractOptions {
  readonly binary: string;
  readonly timeoutMs: number;
}

export class TesseractOcr implements OcrPort {
  constructor(private readonly opts: TesseractOptions) {}

  async recognize(input: { bytes: Uint8Array; mime: string; languages: string }): Promise<OcrOutcome> {
    const ext = IMAGE_EXT[input.mime];
    if (!ext) return { status: "FAILED", retryable: false, code: "UNSUPPORTED_MIME" };
    if (!/^[a-z]{3}(\+[a-z]{3})*$/.test(input.languages)) {
      return { status: "FAILED", retryable: false, code: "INVALID_LANGUAGE" };
    }
    const dir = await mkdtemp(join(tmpdir(), "ekos-ocr-"));
    try {
      const file = join(dir, `in.${ext}`);
      await writeFile(file, input.bytes);
      const tsv = await new Promise<string>((resolvePromise, reject) => {
        execFile(
          this.opts.binary,
          [file, "stdout", "-l", input.languages, "tsv"],
          { timeout: this.opts.timeoutMs, maxBuffer: 32 * 1024 * 1024 },
          (err, stdout) => {
            if (err) reject(err instanceof Error ? err : new Error("tesseract çalıştırılamadı"));
            else resolvePromise(stdout);
          },
        );
      });
      const parsed = parseTesseractTsv(tsv);
      if (!parsed) return { status: "FAILED", retryable: true, code: "OCR_OUTPUT_UNREADABLE" };
      return { status: "OK", pages: [{ page: 1, text: parsed.text, confidence: parsed.confidence }], languages: input.languages };
    } catch {
      // Zaman aşımı, süreç hatası: geçici kabul edilir (yeniden denenebilir).
      return { status: "FAILED", retryable: true, code: "OCR_PROCESS_FAILED" };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
