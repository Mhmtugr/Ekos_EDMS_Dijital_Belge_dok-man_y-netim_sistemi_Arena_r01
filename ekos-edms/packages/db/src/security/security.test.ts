// Faz 7 madde 1: güvenlik testleri. Dinamik (GERÇEK PostgreSQL) ve statik (kaynak tarama) denetimler.
// Mevcut testler IDOR/404, kapsam, kilit, yetki sınırı ve açık DENY durumlarını zaten kapsar; bu dosya kalan
// sınıfları ekler: path traversal, SQL enjeksiyonu, XSS/eval, CSRF (origin), log hijyeni, SSRF, dosya sahteciliği,
// indirme URL'i yokluğu, sahte veri taraması ve yıkıcı komut yasağı.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkUpload, type ActorContext } from "@ekos/core";
import { MemStorage, FakeAv } from "../testing/fakes.js";
import { startTestDb, type TestDb } from "../testing/pg-harness.js";
import { loadActorContext } from "../actor.js";
import { registerUpload } from "../documents/upload.js";
import { searchDocuments } from "../documents/search.js";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const NOW = new Date("2026-10-14T06:00:00Z");

let db: TestDb;
let nobody: ActorContext;

function listFiles(dir: string, out: string[] = []): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  if (statSync(abs).isFile()) {
    if (/\.(ts|tsx|mjs)$/.test(abs) && !/\.test\.(ts|tsx)$/.test(abs)) out.push(abs);
    return out;
  }
  for (const n of readdirSync(abs)) {
    if (["node_modules", ".next", "dist", "coverage", "test-results", "playwright-report"].includes(n)) continue;
    const p = join(abs, n);
    if (statSync(p).isDirectory()) listFiles(relative(ROOT, p).split(sep).join("/"), out);
    else if (/\.(ts|tsx|mjs)$/.test(n) && !/\.test\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}

const PRODUCT_SRC = ["apps/web/app", "apps/web/lib", "apps/web/instrumentation.ts", "packages/core/src", "packages/db/src", "packages/adapters/src", "apps/worker/src"];
const sources = () => PRODUCT_SRC.flatMap((d) => listFiles(d));

beforeAll(async () => {
  db = await startTestDb();
  const u = await db.prisma.user.create({ data: { email: "guvenlik@t.test", displayName: "Yetkisiz", updatedAt: NOW } });
  nobody = await loadActorContext(db.prisma, u.id, NOW);
});

afterAll(async () => {
  await db.stop();
});

describe("dinamik güvenlik testleri (gerçek PostgreSQL)", () => {
  it("path traversal: dosya adı depolama anahtarını etkilemez; anahtar rastgele UUID'dir", async () => {
    const storage = new MemStorage();
    const u = await db.prisma.user.create({ data: { email: "upload-trv@t.test", displayName: "Yükleyen", updatedAt: NOW } });
    const bytes = new TextEncoder().encode("%PDF-1.4 test");
    const r = await registerUpload(
      { prisma: db.prisma, storage },
      { actorId: u.id, correlationId: "sec-1", filename: "../../../etc/passwd.pdf", declaredMime: "application/pdf", bytes, maxBytes: 1_000_000 },
    );
    if (r.status === "QUARANTINED") {
      const file = await db.prisma.documentFileObject.findUniqueOrThrow({ where: { id: r.fileObjectId } });
      expect(file.storageKey).toMatch(/^quarantine\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(file.storageKey).not.toContain("..");
      expect(file.storageKey).not.toContain("etc");
    } else {
      expect(r.issues.length).toBeGreaterThan(0);
    }
    for (const key of storage.map.keys()) expect(key).toMatch(/^quarantine\//);
  });

  it("dosya sahteciliği: PDF uzantısı ama ikili başlık farklıysa yükleme reddedilir", () => {
    const res = checkUpload({ filename: "sozlesme.pdf", declaredMime: "application/pdf", sizeBytes: 12, head: new TextEncoder().encode("MZ\x90\x00executable"), maxBytes: 1000 });
    expect(res.ok).toBe(false);
  });

  it("SQL enjeksiyonu: arama girdisi parametre olarak işlenir; tablo ve veri zarar görmez", async () => {
    const before = await db.prisma.document.count();
    const payload = "'; DROP TABLE \"Document\"; --  \" OR 1=1 --  %_\\";
    const page = await searchDocuments(db.prisma, { actor: nobody, now: NOW, query: payload, limit: 5 });
    expect(page.items).toEqual([]);
    const after = await db.prisma.document.count();
    expect(after).toBe(before);
  });

  it("yetkisiz aktör arama ile belge varlığını öğrenemez (boş sonuç, hata yok)", async () => {
    const page = await searchDocuments(db.prisma, { actor: nobody, now: NOW, query: "sözleşme", limit: 20 });
    expect(page.items.length).toBe(0);
  });

  it("tarama olmadan dosya kullanılamaz: UNAVAILABLE karar değildir, dosya PENDING/UNAVAILABLE kalır", async () => {
    const u = await db.prisma.user.create({ data: { email: "tarama-yok@t.test", displayName: "T", updatedAt: NOW } });
    const storage = new MemStorage();
    const bytes = new TextEncoder().encode("%PDF-1.4 tarama");
    const r = await registerUpload({ prisma: db.prisma, storage }, { actorId: u.id, correlationId: "sec-2", filename: "a.pdf", declaredMime: "application/pdf", bytes, maxBytes: 1_000_000 });
    if (r.status !== "QUARANTINED") throw new Error("yükleme bekleniyordu");
    const av = new FakeAv();
    av.next = { status: "UNAVAILABLE", reason: "tarayıcı kapalı" };
    const { scanFile } = await import("../documents/upload.js");
    await scanFile({ prisma: db.prisma, storage, av }, { fileObjectId: r.fileObjectId, actorId: null, correlationId: "sec-3" });
    const f = await db.prisma.documentFileObject.findUniqueOrThrow({ where: { id: r.fileObjectId } });
    expect(f.scanStatus).not.toBe("CLEAN");
    expect(f.storageKey.startsWith("quarantine/")).toBe(true);
  });
});

describe("statik güvenlik denetimleri (kaynak taraması)", () => {
  it("XSS: ürün kodunda HTML enjeksiyonu API'leri yok (dangerouslySetInnerHTML, innerHTML, document.write)", () => {
    const bad = sources().filter((f) => /dangerouslySetInnerHTML|\.innerHTML\s*=|document\.write\(/.test(readFileSync(f, "utf8")));
    expect(bad.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it("kod çalıştırma: eval / new Function yok", () => {
    const bad = sources().filter((f) => /(^|[^A-Za-z0-9_.])eval\(|new Function\(/.test(readFileSync(f, "utf8")));
    expect(bad.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it("log hijyeni: console çağrıları secret, parola, token veya e-posta değişkeni içermez", () => {
    const offenders: string[] = [];
    for (const f of sources()) {
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/console\.(log|info|warn|error|debug)\(/.test(line) && /(secret|password|parola|token|Token|SECRET|PASSWORD|TOKEN|process\.env|\bemail\b|\be-?posta)/.test(line)) {
            offenders.push(`${relative(ROOT, f)}:${String(i + 1)}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it("CSRF: durum değiştiren API uçları aynı-köken denetimi (requireApiActor) kullanır veya gerekçeli istisnadır", () => {
    const EXEMPT: Record<string, string> = {
      "apps/web/app/api/webhooks/esignature/route.ts": "HMAC imzası (x-ekos-signature) ile korunur; tarayıcı oturumu yoktur",
      "apps/web/app/api/auth/login/route.ts": "oturum henüz yok; parola+TOTP ve hız sınırı ile korunur (Origin denetimi ayrıca yapılır)",
      "apps/web/app/api/auth/logout/route.ts": "kendi oturumunu kapatır; Origin denetimi yapılır",
      "apps/web/app/api/jobs/run/route.ts": "yalnız sunucu içi zamanlayıcıdan çağrılır; paylaşılan sır ile korunur",
    };
    const apiRoutes = listFiles("apps/web/app/api").filter((f) => f.endsWith("route.ts"));
    const missing: string[] = [];
    for (const f of apiRoutes) {
      const src = readFileSync(f, "utf8");
      if (!/export async function (POST|PUT|PATCH|DELETE)\b/.test(src)) continue;
      const rel = relative(ROOT, f).split(sep).join("/");
      if (EXEMPT[rel]) continue;
      if (!/requireApiActor|sameOrigin/.test(src)) missing.push(rel);
    }
    expect(missing).toEqual([]);
  });

  it("SSRF: sunucu, kullanıcı girdisinden gelen URL'ye istek atmaz (fetch hedefleri yapılandırma/sabit)", () => {
    const bad: string[] = [];
    for (const f of sources()) {
      const src = readFileSync(f, "utf8");
      // İstek gövdesi / sorgu parametresi ile fetch(url) kullanımı yasak.
      if (/fetch\(\s*(req|request|body|params|searchParams|input\.|payload\.)/.test(src)) bad.push(relative(ROOT, f));
    }
    expect(bad).toEqual([]);
  });

  it("indirme: imzalı/kalıcı dış URL üretilmez (dosyalar yalnız yetkili API üzerinden akar)", () => {
    const bad = sources().filter((f) => /X-Amz-|presign|getSignedUrl|signedUrl/i.test(readFileSync(f, "utf8")));
    expect(bad.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it("yıkıcı komut yok: üretim kodunda DROP DATABASE/SCHEMA, migrate reset, force-reset, accept-data-loss yok", () => {
    const patterns = [/DROP\s+(DATABASE|SCHEMA)\b/i, /migrate\s+reset/i, /--force-reset/, /--accept-data-loss/, /db\s+push\b/];
    const scanFiles = [
      ...listFiles("packages/db/prisma"),
      ...listFiles("packages/db/scripts"),
      ...listFiles("apps/web/scripts"),
      ...listFiles("docker"),
      ...listFiles(".github"),
      join(ROOT, "package.json"),
      join(ROOT, "packages/db/package.json"),
      join(ROOT, "apps/web/package.json"),
    ].filter((f) => existsSync(f));
    const bad: string[] = [];
    for (const f of scanFiles) {
      const src = readFileSync(f, "utf8");
      if (patterns.some((p) => p.test(src))) bad.push(relative(ROOT, f));
    }
    expect(bad).toEqual([]);
  });
});

describe("migration güvenliği", () => {
  it("migration'larda veri silen/sıfırlayan komut yok (DROP TABLE/COLUMN/SCHEMA, TRUNCATE, DELETE FROM, ALTER ... DROP)", () => {
    const dir = join(ROOT, "packages/db/prisma/migrations");
    const files = readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory()).map((n) => join(dir, n, "migration.sql")).filter((f) => existsSync(f));
    expect(files.length).toBeGreaterThan(0);
    const bad: string[] = [];
    for (const f of files) {
      // Bilinçli istisnalar: CREATE TRIGGER (UPDATE/DELETE/TRUNCATE ENGELLEYEN korumalar; veri silmez) ve REVOKE (yetki kısıtı).
      const src = readFileSync(f, "utf8").replace(/CREATE TRIGGER [^;]*;/gi, "").replace(/REVOKE [^;]*;/gi, "");
      if (/\bDROP\s+(TABLE|COLUMN|SCHEMA|DATABASE|TYPE|INDEX)\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|\bDROP\s+CONSTRAINT\b/i.test(src)) bad.push(relative(ROOT, f));
    }
    expect(bad).toEqual([]);
  });
});

describe("sahte veri ve üretim derlemesi", () => {
  const webBuild = join(ROOT, "apps/web/.next");
  it.skipIf(!existsSync(webBuild))("üretim derlemesinde geliştirme/demo verisi bulunmaz", () => {
    const needles = ["yonetici@ekos.test", "onayci@ekos.test", "denetci@ekos.test", "kullanici@ekos.test", "sozlesme@ekos.test", "Örnek Tedarikçi Ltd. Şti.", "EKOS Test A.Ş.", "ekos-test-only"];
    const hits: string[] = [];
    const walk = (p: string) => {
      for (const n of readdirSync(p)) {
        const q = join(p, n);
        if (statSync(q).isDirectory()) {
          if (n === "cache") continue;
          walk(q);
        } else if (/\.(js|html|json|txt)$/.test(n)) {
          const s = readFileSync(q, "utf8");
          for (const needle of needles) if (s.includes(needle)) hits.push(`${relative(ROOT, q)} ⇒ ${needle}`);
        }
      }
    };
    walk(webBuild);
    expect(hits).toEqual([]);
  });

  it("geliştirme kullanıcıları ve test parolası yalnız seed betiklerinde bulunur", () => {
    // Seed betikleri geliştirme kullanıcısını üretir. runtime-config.ts ise EKOS_DEV_PASSWORD'ün üretimde
  // tanımlanmasını REDDEDEN bir doğrulama kuralıdır (sızıntı değil, koruma); bilinçli olarak izinlidir.
  const seedLike = ["packages/db/scripts/dev-users.ts", "packages/db/scripts/seed.ts", "packages/core/src/config/runtime-config.ts"];
    const offenders = sources().filter((f) => {
      const rel = relative(ROOT, f).split(sep).join("/");
      if (seedLike.includes(rel)) return false;
      return /yonetici@ekos\.test|EKOS_DEV_PASSWORD/.test(readFileSync(f, "utf8"));
    });
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });
});

