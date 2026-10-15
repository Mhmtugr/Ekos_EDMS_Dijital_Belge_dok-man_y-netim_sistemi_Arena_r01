import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClamdAntivirus, encodeInstream, parseClamdReply } from "./antivirus/clamd.js";
import { FsObjectStorage, assertStorageKey } from "./storage/fs-storage.js";
import { TesseractOcr, parseTesseractTsv } from "./ocr/tesseract.js";

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

// ---------- ClamAV ----------
/** Gerçek INSTREAM protokolünü konuşan sahte clamd. mode: ok | eicar | error | silent */
function fakeClamd(mode: "ok" | "eicar" | "error" | "silent"): Promise<{ server: Server; port: number }> {
  return new Promise((resolveP) => {
    const server = createServer((sock) => {
      let buf = Buffer.alloc(0);
      let body = Buffer.alloc(0);
      let headerSeen = false;
      sock.on("data", (d: Buffer) => {
        buf = Buffer.concat([buf, d]);
        if (!headerSeen) {
          const idx = buf.indexOf(0);
          if (idx < 0) return;
          if (buf.subarray(0, idx).toString() !== "zINSTREAM") {
            sock.end("ERROR\0");
            return;
          }
          buf = buf.subarray(idx + 1);
          headerSeen = true;
        }
        // Parçaları oku: [len][data]... [0]
        while (buf.length >= 4) {
          const len = buf.readUInt32BE(0);
          if (len === 0) {
            buf = buf.subarray(4);
            if (mode === "silent") return; // yanıt vermez (zaman aşımı testi)
            if (mode === "error") return void sock.end("stream: INSTREAM size limit exceeded. ERROR\0");
            const hasEicar = body.toString("latin1").includes(EICAR);
            if (mode === "eicar" && hasEicar) return void sock.end("stream: Eicar-Signature FOUND\0");
            return void sock.end("stream: OK\0");
          }
          if (buf.length < 4 + len) return;
          body = Buffer.concat([body, buf.subarray(4, 4 + len)]);
          buf = buf.subarray(4 + len);
        }
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolveP({ server, port: typeof addr === "object" && addr ? addr.port : 0 });
    });
  });
}

describe("ClamAV INSTREAM kodlaması ve yanıt ayrıştırma", () => {
  it("parçalar 4 baytlık BE uzunluk + veri, sonunda 0 uzunluk", () => {
    const out = encodeInstream(enc("abcde"), 2);
    expect(out.subarray(0, 10).toString("ascii")).toBe("zINSTREAM\0");
    expect(out.readUInt32BE(10)).toBe(2);
    expect(out.subarray(14, 16).toString("ascii")).toBe("ab");
    expect(out.subarray(out.length - 4).readUInt32BE(0)).toBe(0);
  });

  it.each([
    ["stream: OK\0", "CLEAN"],
    ["stream: Eicar-Test-Signature FOUND\0", "INFECTED"],
    ["stream: INSTREAM size limit exceeded. ERROR\0", "UNAVAILABLE"],
    ["garbage", "UNAVAILABLE"],
    ["", "UNAVAILABLE"],
  ])("yanıt %j → %s", (reply, status) => {
    expect(parseClamdReply(reply).status).toBe(status);
  });
});

describe("ClamAV istemcisi (sahte clamd sunucusu ile)", () => {
  const servers: Server[] = [];
  afterAll(() => {
    for (const s of servers) s.close();
  });

  it("temiz içerik CLEAN", async () => {
    const f = await fakeClamd("ok");
    servers.push(f.server);
    const r = await new ClamdAntivirus({ host: "127.0.0.1", port: f.port, timeoutMs: 3000 }).scan(enc("merhaba"));
    expect(r).toEqual({ status: "CLEAN" });
  });

  it("EICAR imzalı içerik INFECTED ve imza adı döner (parçalı akışta da)", async () => {
    const f = await fakeClamd("eicar");
    servers.push(f.server);
    const big = enc("x".repeat(5000) + EICAR + "y".repeat(3000));
    const r = await new ClamdAntivirus({ host: "127.0.0.1", port: f.port, timeoutMs: 3000, chunkSize: 1024 }).scan(big);
    expect(r).toEqual({ status: "INFECTED", signature: "Eicar-Signature" });
  });

  it("clamd hata yanıtı UNAVAILABLE (CLEAN asla)", async () => {
    const f = await fakeClamd("error");
    servers.push(f.server);
    const r = await new ClamdAntivirus({ host: "127.0.0.1", port: f.port, timeoutMs: 3000 }).scan(enc("a"));
    expect(r.status).toBe("UNAVAILABLE");
  });

  it("zaman aşımı UNAVAILABLE", async () => {
    const f = await fakeClamd("silent");
    servers.push(f.server);
    const r = await new ClamdAntivirus({ host: "127.0.0.1", port: f.port, timeoutMs: 300 }).scan(enc("a"));
    expect(r).toEqual({ status: "UNAVAILABLE", reason: "CLAMD_TIMEOUT" });
  });

  it("servis kapalıyken (bağlantı reddi) UNAVAILABLE — karantinada kalır", async () => {
    const f = await fakeClamd("ok");
    await new Promise<void>((r) => f.server.close(() => { r(); }));
    const r = await new ClamdAntivirus({ host: "127.0.0.1", port: f.port, timeoutMs: 1000 }).scan(enc("a"));
    expect(r.status).toBe("UNAVAILABLE");
  });
});

// ---------- Depolama ----------
describe("FsObjectStorage", () => {
  let root: string;
  let store: FsObjectStorage;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "ekos-store-"));
    store = new FsObjectStorage(root);
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("yaz, oku, var mı", async () => {
    await store.put("quarantine/a1", enc("veri"));
    expect(new TextDecoder().decode(await store.get("quarantine/a1"))).toBe("veri");
    expect(await store.exists("quarantine/a1")).toBe(true);
    expect(await store.exists("quarantine/yok")).toBe(false);
  });

  it("mevcut anahtarın üzerine yazılmaz", async () => {
    await expect(store.put("quarantine/a1", enc("baska"))).rejects.toThrow();
    expect(new TextDecoder().decode(await store.get("quarantine/a1"))).toBe("veri");
  });

  it("taşıma kaynağı kaldırır ve hedefe taşır (geri alma dahil)", async () => {
    await store.move("quarantine/a1", "objects/a1");
    expect(await store.exists("quarantine/a1")).toBe(false);
    expect(await store.exists("objects/a1")).toBe(true);
    await store.move("objects/a1", "quarantine/a1");
    expect(await store.exists("quarantine/a1")).toBe(true);
    await store.move("quarantine/a1", "objects/a1");
  });

  it("yol dolaşımı ve geçersiz anahtarlar reddedilir", async () => {
    expect(() => { assertStorageKey("../etc/passwd"); }).toThrow();
    expect(() => { assertStorageKey("quarantine/../../x"); }).toThrow();
    expect(() => { assertStorageKey("baska/x"); }).toThrow();
    await expect(store.put("quarantine/..%2f", enc("x"))).rejects.toThrow();
  });

  it("taşıma hedefi zaten varsa kaynak korunur", async () => {
    await store.put("quarantine/c1", enc("c"));
    await store.put("objects/c1", enc("mevcut"));
    await expect(store.move("quarantine/c1", "objects/c1")).rejects.toThrow();
    expect(await store.exists("quarantine/c1")).toBe(true);
    expect(new TextDecoder().decode(await readFile(join(root, "objects/c1")))).toBe("mevcut");
  });
});

// ---------- OCR ----------
describe("Tesseract TSV ayrıştırma", () => {
  it("kelime güvenini ortalar, boş ve -1 güvenleri atlar", () => {
    const tsv = [
      "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
      "1\t1\t0\t0\t0\t0\t0\t0\t100\t100\t-1\t",
      "5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t90\tMerhaba",
      "5\t1\t1\t1\t1\t2\t0\t0\t10\t10\t70\tdünya",
      "5\t1\t1\t1\t1\t3\t0\t0\t10\t10\t-1\t ",
    ].join("\n");
    expect(parseTesseractTsv(tsv)).toEqual({ text: "Merhaba dünya", confidence: 0.8 });
  });
  it("beklenmeyen biçim null", () => {
    expect(parseTesseractTsv("foo\tbar")).toBeNull();
  });
});

describe("TesseractOcr (sahte tesseract ikilisi ile)", () => {
  let dir: string;
  let okBin: string;
  let failBin: string;
  const TSV = [
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
    "5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t95\tİSTANBUL",
    "5\t1\t1\t1\t1\t2\t0\t0\t10\t10\t85\tşirket",
  ].join("\n");
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ekos-bin-"));
    okBin = join(dir, "tess-ok");
    failBin = join(dir, "tess-fail");
    await writeFile(okBin, `#!/bin/sh\ncat <<'EOF'\n${TSV}\nEOF\n`);
    await writeFile(failBin, "#!/bin/sh\necho boom >&2\nexit 1\n");
    await chmod(okBin, 0o755);
    await chmod(failBin, 0o755);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("görüntü için sayfa metni ve güven döner", async () => {
    const r = await new TesseractOcr({ binary: okBin, timeoutMs: 5000 }).recognize({
      bytes: enc("img"),
      mime: "image/png",
      languages: "tur+eng",
    });
    expect(r).toEqual({
      status: "OK",
      languages: "tur+eng",
      pages: [{ page: 1, text: "İSTANBUL şirket", confidence: 0.9 }],
    });
  });

  it("süreç hatası yeniden denenebilir FAILED — uydurma metin yok", async () => {
    const r = await new TesseractOcr({ binary: failBin, timeoutMs: 5000 }).recognize({
      bytes: enc("img"),
      mime: "image/png",
      languages: "tur",
    });
    expect(r).toEqual({ status: "FAILED", retryable: true, code: "OCR_PROCESS_FAILED" });
  });

  it("bu sürümde desteklenmeyen PDF yeniden denenmez (FINAL)", async () => {
    const r = await new TesseractOcr({ binary: okBin, timeoutMs: 5000 }).recognize({
      bytes: enc("%PDF"),
      mime: "application/pdf",
      languages: "tur",
    });
    expect(r).toEqual({ status: "FAILED", retryable: false, code: "UNSUPPORTED_MIME" });
  });

  it("enjeksiyon içeren dil parametresi reddedilir", async () => {
    const r = await new TesseractOcr({ binary: okBin, timeoutMs: 5000 }).recognize({
      bytes: enc("img"),
      mime: "image/png",
      languages: "tur;rm -rf /",
    });
    expect(r).toEqual({ status: "FAILED", retryable: false, code: "INVALID_LANGUAGE" });
  });
});
