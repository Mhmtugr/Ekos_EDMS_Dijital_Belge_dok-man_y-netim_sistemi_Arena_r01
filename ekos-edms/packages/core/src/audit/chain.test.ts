import { describe, expect, it } from "vitest";
import {
  GENESIS_HASH,
  canonicalJson,
  computeAuditHash,
  verifyAuditChain,
  type AuditHashInput,
  type StoredAuditEvent,
} from "./chain.js";

const base = (seq: number, over: Partial<AuditHashInput> = {}): AuditHashInput => ({
  sequence: BigInt(seq),
  occurredAt: new Date(`2026-10-13T09:0${String(seq)}:00Z`),
  actorType: "USER",
  actorId: "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa",
  eventType: "USER_CREATED",
  targetType: "User",
  targetId: "bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb",
  targetVersion: 1,
  outcome: "SUCCESS",
  reason: null,
  correlationId: "corr-1",
  requestId: null,
  beforeSummary: null,
  afterSummary: { status: "ACTIVE" },
  ...over,
});

function buildChain(n: number): StoredAuditEvent[] {
  const out: StoredAuditEvent[] = [];
  let prev = GENESIS_HASH;
  for (let i = 1; i <= n; i++) {
    const input = base(i);
    const hash = computeAuditHash(prev, input);
    out.push({ ...input, prevHash: prev, hash });
    prev = hash;
  }
  return out;
}

describe("canonicalJson", () => {
  it("anahtar sırasından bağımsızdır", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
  it("undefined alanları atlar, bigint ve Date'i dönüştürür", () => {
    expect(canonicalJson({ x: undefined, n: 5n, t: new Date("2026-01-01T00:00:00Z") })).toBe(
      '{"n":"5","t":"2026-01-01T00:00:00.000Z"}',
    );
  });
  it("sonlu olmayan sayıyı reddeder", () => {
    expect(() => canonicalJson({ v: Number.NaN })).toThrow();
  });
});

describe("denetim zinciri", () => {
  it("geçerli zincir doğrulanır", () => {
    expect(verifyAuditChain(buildChain(5))).toEqual({ ok: true, checked: 5 });
  });

  it("boş zincir geçerlidir", () => {
    expect(verifyAuditChain([])).toEqual({ ok: true, checked: 0 });
  });

  it("bir olayın özet alanı değiştirilirse HASH_MISMATCH", () => {
    const chain = buildChain(4);
    const tampered = chain.map((e, i) => (i === 1 ? { ...e, afterSummary: { status: "DISABLED" } } : e));
    expect(verifyAuditChain(tampered)).toEqual({ ok: false, sequence: 2n, reason: "HASH_MISMATCH" });
  });

  it("gerekçe (reason) alanı değiştirilirse de tespit edilir", () => {
    const chain = buildChain(3);
    const tampered = chain.map((e, i) => (i === 2 ? { ...e, reason: "değiştirildi" } : e));
    expect(verifyAuditChain(tampered).ok).toBe(false);
  });

  it("ortadan kayıt silinirse SEQUENCE_GAP", () => {
    const chain = buildChain(4);
    const withGap = [chain[0], chain[2], chain[3]] as StoredAuditEvent[];
    expect(verifyAuditChain(withGap)).toEqual({ ok: false, sequence: 3n, reason: "SEQUENCE_GAP" });
  });

  it("zincir başlangıcı genesis değilse reddedilir", () => {
    const chain = buildChain(2);
    expect(verifyAuditChain(chain.slice(1))).toEqual({
      ok: false,
      sequence: 2n,
      reason: "FIRST_PREV_NOT_GENESIS",
    });
  });

  it("önceki hash bağı kırılırsa PREV_HASH_MISMATCH", () => {
    const chain = buildChain(3);
    const relinked = chain.map((e, i) => (i === 2 ? { ...e, prevHash: "f".repeat(64) } : e));
    expect(verifyAuditChain(relinked)).toEqual({ ok: false, sequence: 3n, reason: "PREV_HASH_MISMATCH" });
  });

  it("geçersiz önceki hash biçimi hata verir", () => {
    expect(() => computeAuditHash("xyz", base(1))).toThrow();
  });
});
