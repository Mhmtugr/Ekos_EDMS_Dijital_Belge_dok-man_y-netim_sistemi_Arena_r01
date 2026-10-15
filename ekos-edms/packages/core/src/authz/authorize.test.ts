import { describe, expect, it } from "vitest";
import {
  authorize,
  deniedHttpStatus,
  membershipScopeIsValid,
  type ActorContext,
  type AuthorizeInput,
  type MembershipGrant,
  type ResourceRef,
} from "./authorize.js";

const NOW = new Date("2026-10-13T09:00:00Z");
const DEPT_A = "11111111-1111-7111-8111-111111111111";
const DEPT_B = "22222222-2222-7222-8222-222222222222";
const USER = "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb";
const DOC = "dddddddd-dddd-7ddd-8ddd-dddddddddddd";

function membership(over: Partial<MembershipGrant> = {}): MembershipGrant {
  return {
    membershipId: "m1",
    roleCode: "DEPARTMENT_USER",
    permissions: ["document.list", "document.view_metadata", "document.download"],
    scope: {},
    validFrom: null,
    validUntil: null,
    revokedAt: null,
    ...over,
  };
}

function actor(over: Partial<ActorContext> = {}): ActorContext {
  return {
    userId: USER,
    status: "ACTIVE",
    groupIds: [],
    memberships: [membership()],
    breakGlass: [],
    ...over,
  };
}

const doc = (over: Partial<ResourceRef> = {}): ResourceRef => ({
  id: DOC,
  kind: "DOCUMENT",
  departmentId: DEPT_A,
  documentTypeId: "t1",
  counterpartyId: null,
  projectId: null,
  confidentiality: "CONFIDENTIAL",
  ...over,
});

const run = (over: Partial<AuthorizeInput>): ReturnType<typeof authorize> =>
  authorize({ actor: actor(), permission: "document.list", resource: doc(), now: NOW, ...over });

describe("authorize: varsayılan red", () => {
  it("üyeliği olmayan kullanıcı her izni reddedilir", () => {
    expect(run({ actor: actor({ memberships: [] }) })).toEqual({ allowed: false, reason: "NO_GRANT" });
  });

  it("izin kodu kataloğda değilse reddedilir (ör. yazım hatası)", () => {
    expect(run({ permission: "document.delete_all" })).toEqual({
      allowed: false,
      reason: "INVALID_PERMISSION",
    });
  });

  it("rolde olmayan izin reddedilir (download var, approve yok)", () => {
    expect(run({ permission: "document.approve" })).toEqual({ allowed: false, reason: "NO_GRANT" });
  });
});

describe("authorize: hesap durumu ve üyelik geçerliliği", () => {
  it.each(["DISABLED", "OFFBOARDING"] as const)("%s hesap hiçbir izin alamaz", (status) => {
    expect(run({ actor: actor({ status }) })).toEqual({ allowed: false, reason: "ACTOR_INACTIVE" });
  });

  it("iptal edilmiş üyelik geçerli değildir", () => {
    const a = actor({ memberships: [membership({ revokedAt: new Date("2026-10-01T00:00:00Z") })] });
    expect(run({ actor: a })).toEqual({ allowed: false, reason: "NO_GRANT" });
  });

  it("henüz başlamamış üyelik geçerli değildir", () => {
    const a = actor({ memberships: [membership({ validFrom: new Date("2026-11-01T00:00:00Z") })] });
    expect(run({ actor: a }).allowed).toBe(false);
  });

  it("süresi dolmuş üyelik geçerli değildir", () => {
    const a = actor({ memberships: [membership({ validUntil: new Date("2026-10-01T00:00:00Z") })] });
    expect(run({ actor: a }).allowed).toBe(false);
  });

  it("geçerlilik penceresi içindeki üyelik izin verir", () => {
    const a = actor({
      memberships: [
        membership({
          validFrom: new Date("2026-10-01T00:00:00Z"),
          validUntil: new Date("2026-12-31T00:00:00Z"),
        }),
      ],
    });
    expect(run({ actor: a }).allowed).toBe(true);
  });
});

describe("authorize: kapsam kesişimi", () => {
  it("kapsamsız üyelik her departmanda izin verir", () => {
    expect(run({ resource: doc({ departmentId: DEPT_B }) }).allowed).toBe(true);
  });

  it("departman kapsamı eşleşirse izin verir", () => {
    const a = actor({ memberships: [membership({ scope: { departmentIds: [DEPT_A] } })] });
    expect(run({ actor: a }).allowed).toBe(true);
  });

  it("departman kapsamı eşleşmezse SCOPE_MISMATCH (görünürlük kontrolü ayrıca 404 döner)", () => {
    const a = actor({ memberships: [membership({ scope: { departmentIds: [DEPT_B] } })] });
    expect(run({ actor: a })).toEqual({ allowed: false, reason: "SCOPE_MISMATCH" });
  });

  it("kaynakta departman boşsa departman kapsamlı üyelik eşleşmez", () => {
    const a = actor({ memberships: [membership({ scope: { departmentIds: [DEPT_A] } })] });
    expect(run({ actor: a, resource: doc({ departmentId: null }) }).allowed).toBe(false);
  });

  it("belge türü kapsamı", () => {
    const a = actor({ memberships: [membership({ scope: { documentTypeIds: ["t2"] } })] });
    expect(run({ actor: a }).allowed).toBe(false);
    const b = actor({ memberships: [membership({ scope: { documentTypeIds: ["t1"] } })] });
    expect(run({ actor: b }).allowed).toBe(true);
  });

  it("tek belge kapsamı yalnızca o belgeye izin verir", () => {
    const a = actor({ memberships: [membership({ scope: { documentId: DOC } })] });
    expect(run({ actor: a }).allowed).toBe(true);
    expect(run({ actor: a, resource: doc({ id: "other-doc" }) }).allowed).toBe(false);
  });

  it("sistem düzeyi işlemde (kaynak yok) kısıtlı kapsam eşleşmez", () => {
    const a = actor({
      memberships: [membership({ permissions: ["user.manage"], scope: { departmentIds: [DEPT_A] } })],
    });
    expect(
      authorize({ actor: a, permission: "user.manage", now: NOW }),
    ).toEqual({ allowed: false, reason: "SCOPE_MISMATCH" });
  });

  it("sistem düzeyi işlemde kapsamsız üyelik izin verir", () => {
    const a = actor({ memberships: [membership({ permissions: ["user.manage"] })] });
    expect(authorize({ actor: a, permission: "user.manage", now: NOW }).allowed).toBe(true);
  });
});

describe("authorize: gizlilik tavanı", () => {
  const capped = actor({
    memberships: [membership({ scope: { maxConfidentiality: "CONFIDENTIAL" } })],
  });

  it("tavan altındaki gizlilik izin verir", () => {
    expect(run({ actor: capped, resource: doc({ confidentiality: "INTERNAL" }) }).allowed).toBe(true);
  });

  it("tavanı aşan gizlilik CONFIDENTIALITY_EXCEEDED ile reddedilir", () => {
    expect(run({ actor: capped, resource: doc({ confidentiality: "RESTRICTED" }) })).toEqual({
      allowed: false,
      reason: "CONFIDENTIALITY_EXCEEDED",
    });
  });

  it("gizlilik bilinmiyorsa tavanlı üyelik eşleşmez", () => {
    expect(run({ actor: capped, resource: doc({ confidentiality: null }) }).allowed).toBe(false);
  });

  it("İK belgesi (HIGHLY_RESTRICTED): varsayılan kapsamlı kullanıcıya kapalıdır", () => {
    const hr = doc({ confidentiality: "HIGHLY_RESTRICTED" });
    expect(run({ actor: capped, resource: hr }).allowed).toBe(false);
  });
});

describe("authorize: DENY önceliği ve ACL", () => {
  it("açık DENY, geçerli kapsamlı üyeliği bile geçersiz kılar", () => {
    const acl = [{ effect: "DENY" as const, permissionCode: "document.download", subject: { type: "USER" as const, id: USER } }];
    expect(run({ permission: "document.download", acl })).toEqual({ allowed: false, reason: "ACL_DENY" });
  });

  it("grup üzerinden DENY de uygulanır", () => {
    const a = actor({ groupIds: ["g1"] });
    const acl = [{ effect: "DENY" as const, permissionCode: "document.download", subject: { type: "GROUP" as const, id: "g1" } }];
    expect(run({ actor: a, permission: "document.download", acl }).allowed).toBe(false);
  });

  it("rol üzerinden DENY de uygulanır", () => {
    const acl = [{ effect: "DENY" as const, permissionCode: "document.download", subject: { type: "ROLE" as const, id: "DEPARTMENT_USER" } }];
    expect(run({ permission: "document.download", acl }).allowed).toBe(false);
  });

  it("DENY başka kullanıcıya aitse etkisizdir", () => {
    const acl = [{ effect: "DENY" as const, permissionCode: "document.download", subject: { type: "USER" as const, id: OTHER } }];
    expect(run({ permission: "document.download", acl }).allowed).toBe(true);
  });

  it("DENY başka izin koduna aitse etkisizdir", () => {
    const acl = [{ effect: "DENY" as const, permissionCode: "document.list", subject: { type: "USER" as const, id: USER } }];
    expect(run({ permission: "document.download", acl }).allowed).toBe(true);
  });

  it("açık ALLOW, üyelik olmadan izin verir (ACL_ALLOW)", () => {
    const a = actor({ memberships: [] });
    const acl = [{ effect: "ALLOW" as const, permissionCode: "document.preview", subject: { type: "USER" as const, id: USER } }];
    expect(run({ actor: a, permission: "document.preview", acl })).toEqual({ allowed: true, reason: "ACL_ALLOW" });
  });

  it("DENY, ALLOW'a üstün gelir", () => {
    const a = actor({ memberships: [] });
    const acl = [
      { effect: "ALLOW" as const, permissionCode: "document.preview", subject: { type: "USER" as const, id: USER } },
      { effect: "DENY" as const, permissionCode: "document.preview", subject: { type: "USER" as const, id: USER } },
    ];
    expect(run({ actor: a, permission: "document.preview", acl }).allowed).toBe(false);
  });

  it("sistem düzeyinde ACL değerlendirilmez (kaynak yok)", () => {
    const acl = [{ effect: "DENY" as const, permissionCode: "user.manage", subject: { type: "USER" as const, id: USER } }];
    const a = actor({ memberships: [membership({ permissions: ["user.manage"] })] });
    expect(authorize({ actor: a, permission: "user.manage", acl, now: NOW }).allowed).toBe(true);
  });
});

describe("authorize: kırılma-cam (break-glass)", () => {
  const approvedGrant = {
    grantId: "bg1",
    resourceId: DOC,
    permissions: ["document.preview"],
    requestedById: USER,
    approvedById: OTHER,
    startsAt: new Date("2026-10-13T08:00:00Z"),
    expiresAt: new Date("2026-10-13T10:00:00Z"),
    status: "APPROVED" as const,
  };
  const noMembership = actor({ memberships: [] });

  it("süreli ve onaylı kayıt izin verir", () => {
    const a = { ...noMembership, breakGlass: [approvedGrant] };
    expect(run({ actor: a, permission: "document.preview" })).toEqual({ allowed: true, reason: "BREAK_GLASS" });
  });

  it("süre dolunca reddedilir", () => {
    const a = { ...noMembership, breakGlass: [approvedGrant] };
    expect(run({ actor: a, permission: "document.preview", now: new Date("2026-10-13T10:00:00Z") }).allowed).toBe(false);
  });

  it("onaylanmamış kayıt reddedilir", () => {
    const a = { ...noMembership, breakGlass: [{ ...approvedGrant, status: "REQUESTED" as const }] };
    expect(run({ actor: a, permission: "document.preview" }).allowed).toBe(false);
  });

  it("kendi talebini kendisi onaylayamaz (onaycı = talep eden)", () => {
    const a = { ...noMembership, breakGlass: [{ ...approvedGrant, approvedById: USER }] };
    expect(run({ actor: a, permission: "document.preview" }).allowed).toBe(false);
  });

  it("yalnızca talep edilen belge için geçerlidir", () => {
    const a = { ...noMembership, breakGlass: [approvedGrant] };
    expect(run({ actor: a, permission: "document.preview", resource: doc({ id: "baska" }) }).allowed).toBe(false);
  });

  it("kayıt yalnızca talep edilen izin için geçerlidir", () => {
    const a = { ...noMembership, breakGlass: [approvedGrant] };
    expect(run({ actor: a, permission: "document.download" }).allowed).toBe(false);
  });

  it("başkasının talebi bu kullanıcıya izin vermez", () => {
    const a = { ...noMembership, breakGlass: [{ ...approvedGrant, requestedById: OTHER }] };
    expect(run({ actor: a, permission: "document.preview" }).allowed).toBe(false);
  });
});

describe("404/403 ayrımı (deniedHttpStatus)", () => {
  it("görmeye hiç yetkisi yoksa 404 (varlık sızdırılmaz)", () => {
    const input = { actor: actor({ memberships: [] }), permission: "document.download", resource: doc(), now: NOW };
    expect(deniedHttpStatus(input, "document.view_metadata")).toBe(404);
  });

  it("görebiliyor ama indiremiyorsa 403", () => {
    const a = actor({ memberships: [membership({ permissions: ["document.view_metadata"] })] });
    const input = { actor: a, permission: "document.download", resource: doc(), now: NOW };
    expect(deniedHttpStatus(input, "document.view_metadata")).toBe(403);
  });

  it("kapsam dışı belge görünmez: 404", () => {
    const a = actor({ memberships: [membership({ scope: { departmentIds: [DEPT_B] } })] });
    const input = { actor: a, permission: "document.download", resource: doc(), now: NOW };
    expect(deniedHttpStatus(input, "document.view_metadata")).toBe(404);
  });
});

describe("membershipScopeIsValid (K hücreleri için kapsam zorunluluğu)", () => {
  it("kapsam zorunlu izin varsa boş kapsam reddedilir", () => {
    expect(membershipScopeIsValid(["document.edit_metadata"], {})).toBe(false);
  });
  it("en az bir kapsam alanı varsa kabul edilir", () => {
    expect(membershipScopeIsValid(["document.edit_metadata"], { departmentIds: [DEPT_A] })).toBe(true);
  });
  it("kapsam zorunlu izin yoksa boş kapsam kabul edilir", () => {
    expect(membershipScopeIsValid([], {})).toBe(true);
  });
});
