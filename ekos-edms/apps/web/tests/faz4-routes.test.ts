// Faz 4 HTTP rota testleri (GERÇEK PostgreSQL + gerçek route handler'ları). Oturum: doğrudan authSession satırı.
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashToken, loadActorContext } from "@ekos/db";
import { startTestDb, type TestDb } from "../../../packages/db/src/testing/pg-harness";

const NOW = new Date();
const EMPTY_SCOPE = { departmentIds: [], documentTypeIds: [], counterpartyIds: [], projectIds: [], updatedAt: NOW };
const ORIGIN = "http://app.test";

let db: TestDb;
let admin = "";
let plain = "";
let adminCookie = "";
let plainCookie = "";
let emp = "";
let mods: Record<string, Record<string, unknown>> = {};

async function session(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.prisma.authSession.create({
    data: { userId, tokenHash: hashToken(token), createdAt: NOW, expiresAt: new Date(NOW.getTime() + 3_600_000), lastSeenAt: NOW },
  });
  return `ekos_session=${token}`;
}

function req(method: string, path: string, opts: { cookie?: string; body?: unknown; origin?: string | null } = {}): Request {
  const headers: Record<string, string> = { host: "app.test" };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, { method, headers, body: opts.body === undefined ? null : JSON.stringify(opts.body) });
}

const ctxOf = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
  db = await startTestDb();
  process.env.AUTH_MODE = "local";
  process.env.DATABASE_URL = db.url;
  process.env.STORAGE_ROOT = mkdtempSync(join(tmpdir(), "ekos-routes-"));
  const p = db.prisma;
  const codes = ["config.manage", "user.manage", "breakglass.approve", "audit.export"];
  await p.permission.createMany({ data: codes.map((code) => ({ code, description: code })) });
  const perms = await p.permission.findMany();
  const role = await p.role.create({ data: { code: "R_OPS", name: "R_OPS", updatedAt: NOW } });
  for (const c of codes) await p.rolePermission.create({ data: { roleId: role.id, permissionId: perms.find((x) => x.code === c)?.id ?? "" } });
  admin = (await p.user.create({ data: { email: "admin@r.test", displayName: "Yönetici", updatedAt: NOW } })).id;
  plain = (await p.user.create({ data: { email: "plain@r.test", displayName: "Sıradan", updatedAt: NOW } })).id;
  emp = (await p.user.create({ data: { email: "ayrilan@r.test", displayName: "Ayrılan Kişi", updatedAt: NOW } })).id;
  await p.user.create({ data: { email: "pasif@r.test", displayName: "Pasif Kişi", status: "DISABLED", updatedAt: NOW } });
  await p.membership.create({ data: { userId: admin, roleId: role.id, ...EMPTY_SCOPE } as never });
  adminCookie = await session(admin);
  plainCookie = await session(plain);
  // Oturum çözümlemesinin gerçekten çalıştığını doğrula.
  expect(await loadActorContext(p, admin)).toBeTruthy();

  mods = {
    offboarding: (await import("../app/api/offboarding/route")),
    offboardingCancel: (await import("../app/api/offboarding/[id]/cancel/route")),
    picker: (await import("../app/api/users/picker/route")),
    fiscal: (await import("../app/api/governance/fiscal-year-ends/route")),
    executed: (await import("../app/api/disposal/executed/route")),
    cert: (await import("../app/api/disposal/reviews/[id]/certificate/route")),
    breakglass: (await import("../app/api/breakglass/route")),
  };
});

afterAll(async () => {
  await db.stop();
});

const call = async (mod: string, method: "GET" | "POST", r: Request, params?: { id: string }): Promise<Response> => {
  const m = mods[mod] ?? {};
  const fn = m[method] as (q: Request, c?: unknown) => Promise<Response>;
  return fn(r, params ? ctxOf(params.id) : undefined);
};

describe("kimlik ve yetki (HTTP)", () => {
  it("oturumsuz istek 401; yetkisiz kullanıcı 403", async () => {
    expect((await call("offboarding", "GET", req("GET", "/api/offboarding"))).status).toBe(401);
    expect((await call("offboarding", "GET", req("GET", "/api/offboarding", { cookie: plainCookie }))).status).toBe(403);
    expect((await call("picker", "GET", req("GET", "/api/users/picker?q=a", { cookie: plainCookie }))).status).toBe(403);
    expect((await call("fiscal", "GET", req("GET", "/api/governance/fiscal-year-ends", { cookie: plainCookie }))).status).toBe(403);
    expect((await call("executed", "GET", req("GET", "/api/disposal/executed", { cookie: plainCookie }))).status).toBe(403);
    expect((await call("cert", "GET", req("GET", "/api/x", { cookie: plainCookie }), { id: "00000000-0000-7000-8000-000000000000" })).status).toBe(403);
  });

  it("durum değiştiren istekte farklı Origin CSRF ile reddedilir", async () => {
    const r = await call("fiscal", "POST", req("POST", "/api/governance/fiscal-year-ends", { cookie: adminCookie, origin: "http://evil.test", body: { year: 2024, endDate: "2024-12-31", expectedRowVersion: null } }));
    expect(r.status).toBe(403);
    expect(((await r.json()) as { code: string }).code).toBe("CSRF_REJECTED");
  });
});

describe("kullanıcı seçici (HTTP)", () => {
  it("yalnızca aktif hesaplar, yalnızca ad/e-posta/kimlik alanları", async () => {
    const r = await call("picker", "GET", req("GET", "/api/users/picker?q=pasif", { cookie: adminCookie }));
    expect(r.status).toBe(200);
    expect(((await r.json()) as { items: unknown[] }).items).toEqual([]);
    const ok = await call("picker", "GET", req("GET", "/api/users/picker?q=ayrilan", { cookie: adminCookie }));
    const body = (await ok.json()) as { items: Record<string, unknown>[] };
    expect(body.items.map((x) => x.displayName)).toEqual(["Ayrılan Kişi"]);
    expect(Object.keys(body.items[0] ?? {}).sort()).toEqual(["displayName", "email", "id"]);
  });
});

describe("mali yıl takvimi (HTTP)", () => {
  it("geçersiz gövde 422, geçerli kayıt 200, eski sürüm 409", async () => {
    const bad = await call("fiscal", "POST", req("POST", "/api/governance/fiscal-year-ends", { cookie: adminCookie, body: { year: 2024, endDate: "2025-12-31", expectedRowVersion: null } }));
    expect(bad.status).toBe(422);
    const bad2 = await call("fiscal", "POST", req("POST", "/api/governance/fiscal-year-ends", { cookie: adminCookie, body: { year: 2024, endDate: "2024-12-31", expectedRowVersion: "x" } }));
    expect(bad2.status).toBe(422);
    const ok = await call("fiscal", "POST", req("POST", "/api/governance/fiscal-year-ends", { cookie: adminCookie, body: { year: 2024, endDate: "2024-12-31", expectedRowVersion: null } }));
    expect(ok.status).toBe(200);
    const stale = await call("fiscal", "POST", req("POST", "/api/governance/fiscal-year-ends", { cookie: adminCookie, body: { year: 2024, endDate: "2024-11-30", expectedRowVersion: null } }));
    expect(stale.status).toBe(409);
    const list = await call("fiscal", "GET", req("GET", "/api/governance/fiscal-year-ends", { cookie: adminCookie }));
    const items = ((await list.json()) as { items: { year: number }[] }).items;
    expect(items.some((x) => x.year === 2024)).toBe(true);
  });
});

describe("ayrılış dosyası (HTTP)", () => {
  let caseId = "";
  it("aç, listele, filtrele, iptal et", async () => {
    const opened = await call("offboarding", "POST", req("POST", "/api/offboarding", { cookie: adminCookie, body: { userId: emp, reason: "İşten ayrılış" } }));
    expect(opened.status).toBe(201);
    caseId = ((await opened.json()) as { caseId: string }).caseId;
    const open = await call("offboarding", "GET", req("GET", "/api/offboarding?status=OPEN", { cookie: adminCookie }));
    expect(((await open.json()) as { items: { id: string }[] }).items.some((x) => x.id === caseId)).toBe(true);
    const badFilter = await call("offboarding", "GET", req("GET", "/api/offboarding?status=HEPSI", { cookie: adminCookie }));
    expect(badFilter.status).toBe(422);

    const noReason = await call("offboardingCancel", "POST", req("POST", `/api/offboarding/${caseId}/cancel`, { cookie: adminCookie, body: { reason: "", expectedRowVersion: 1 } }), { id: caseId });
    expect(noReason.status).toBe(422);
    const badId = await call("offboardingCancel", "POST", req("POST", "/api/offboarding/x/cancel", { cookie: adminCookie, body: { reason: "Kurumda kalıyor", expectedRowVersion: 1 } }), { id: "x" });
    expect(badId.status).toBe(404);
    const cancel = await call("offboardingCancel", "POST", req("POST", `/api/offboarding/${caseId}/cancel`, { cookie: adminCookie, body: { reason: "Kurumda kalıyor", expectedRowVersion: 1 } }), { id: caseId });
    expect(cancel.status).toBe(200);
    const u = await db.prisma.user.findUniqueOrThrow({ where: { id: emp } });
    expect(u.status).toBe("ACTIVE");
    const again = await call("offboardingCancel", "POST", req("POST", `/api/offboarding/${caseId}/cancel`, { cookie: adminCookie, body: { reason: "Tekrar", expectedRowVersion: 2 } }), { id: caseId });
    // Durum çakışması (zaten iptal edilmiş dosya) → 409 STATE; sürüm kontrolü durumdan sonra çalışır.
    expect(again.status).toBe(409);
  });
});

describe("kırılma-cam, yürütülmüş imha ve tutanak (HTTP)", () => {
  it("sayfa parametresi doğrulanır; yapı {items,hasMore,page}", async () => {
    const bad = await call("breakglass", "GET", req("GET", "/api/breakglass?page=0", { cookie: plainCookie }));
    expect(bad.status).toBe(422);
    const ok = await call("breakglass", "GET", req("GET", "/api/breakglass?page=1", { cookie: plainCookie }));
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { items: unknown[]; hasMore: boolean; page: number };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.hasMore).toBe(false);
    expect(body.page).toBe(1);
  });

  it("yürütülmüş imha listesi boş (imha yok) ve bilinmeyen tutanak 404", async () => {
    const list = await call("executed", "GET", req("GET", "/api/disposal/executed", { cookie: adminCookie }));
    expect(list.status).toBe(200);
    expect(((await list.json()) as { items: unknown[] }).items).toEqual([]);
    const missing = await call("cert", "GET", req("GET", "/api/disposal/reviews/x/certificate", { cookie: adminCookie }), { id: "00000000-0000-7000-8000-000000000000" });
    expect(missing.status).toBe(404);
  });
});
