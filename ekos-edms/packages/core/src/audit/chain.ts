// Denetim izi SHA-256 zinciri (ADR-0007). Yalnızca TAHRİFAT TESPİTİ sağlar; değiştirilemezlik sertifikası DEĞİLDİR.
import { createHash } from "node:crypto";

export const GENESIS_HASH = "0".repeat(64);

/** Anahtarları sıralı, kararlı JSON. undefined alanlar atlanır; bigint string, Date ISO olur. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Sonlu olmayan sayı denetim kaydına yazılamaz");
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => normalize(v));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = normalize(v);
    }
    return out;
  }
  throw new Error(`Desteklenmeyen tip: ${typeof value}`);
}

export interface AuditHashInput {
  readonly sequence: bigint;
  readonly occurredAt: Date;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly eventType: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly targetVersion: number | null;
  readonly outcome: string;
  readonly reason: string | null;
  readonly correlationId: string;
  readonly requestId: string | null;
  readonly beforeSummary: unknown;
  readonly afterSummary: unknown;
}

export function computeAuditHash(prevHash: string, input: AuditHashInput): string {
  if (!/^[0-9a-f]{64}$/.test(prevHash)) throw new Error("Geçersiz önceki hash");
  return createHash("sha256")
    .update(prevHash)
    .update("\n")
    .update(canonicalJson(input))
    .digest("hex");
}

export interface StoredAuditEvent extends AuditHashInput {
  readonly prevHash: string;
  readonly hash: string;
}

export type ChainVerification =
  | { readonly ok: true; readonly checked: number }
  | {
      readonly ok: false;
      readonly sequence: bigint;
      readonly reason: "SEQUENCE_GAP" | "PREV_HASH_MISMATCH" | "HASH_MISMATCH" | "FIRST_PREV_NOT_GENESIS";
    };

/** Hash girdisi yalnızca AuditHashInput alanlarıdır; prevHash/hash hariç tutulur. */
export function hashInputOf(e: AuditHashInput): AuditHashInput {
  return {
    sequence: e.sequence,
    occurredAt: e.occurredAt,
    actorType: e.actorType,
    actorId: e.actorId,
    eventType: e.eventType,
    targetType: e.targetType,
    targetId: e.targetId,
    targetVersion: e.targetVersion,
    outcome: e.outcome,
    reason: e.reason,
    correlationId: e.correlationId,
    requestId: e.requestId,
    beforeSummary: e.beforeSummary,
    afterSummary: e.afterSummary,
  };
}

/** Olaylar sequence'a göre artan sırada verilmelidir. */
export function verifyAuditChain(events: readonly StoredAuditEvent[]): ChainVerification {
  let expectedPrev = GENESIS_HASH;
  let expectedSeq: bigint | null = null;
  let checked = 0;
  for (const e of events) {
    if (expectedSeq === null) {
      if (e.prevHash !== GENESIS_HASH) {
        return { ok: false, sequence: e.sequence, reason: "FIRST_PREV_NOT_GENESIS" };
      }
      expectedSeq = e.sequence;
    } else if (e.sequence !== expectedSeq) {
      return { ok: false, sequence: e.sequence, reason: "SEQUENCE_GAP" };
    }
    if (e.prevHash !== expectedPrev) {
      return { ok: false, sequence: e.sequence, reason: "PREV_HASH_MISMATCH" };
    }
    if (computeAuditHash(e.prevHash, hashInputOf(e)) !== e.hash) {
      return { ok: false, sequence: e.sequence, reason: "HASH_MISMATCH" };
    }
    expectedPrev = e.hash;
    expectedSeq = e.sequence + 1n;
    checked++;
  }
  return { ok: true, checked };
}
