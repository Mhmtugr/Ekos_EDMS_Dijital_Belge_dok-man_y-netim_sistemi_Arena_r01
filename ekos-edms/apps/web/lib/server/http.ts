// HTTP yardımcıları: standart hata biçimi (A5/7), aynı-köken denetimi (CSRF), oturum çerezi.
import { randomUUID } from "node:crypto";
import { statusFor, toApiError, type ApiErrorCode } from "@ekos/core";
import { DomainError } from "@ekos/db";
import { ConfigError } from "./runtime";

export const SESSION_COOKIE = "ekos_session";
export const SESSION_MAX_AGE_S = 8 * 60 * 60;

const DOMAIN_TO_API: Record<string, ApiErrorCode> = {
  NOT_FOUND: "NOT_FOUND",
  FORBIDDEN: "FORBIDDEN",
  VERSION_CONFLICT: "VERSION_CONFLICT",
  OCR_NOT_RETRYABLE: "VERSION_CONFLICT",
  VERSION_LOCKED: "VERSION_CONFLICT",
  DECISION_DENIED: "FORBIDDEN",
  SEPARATION_OF_DUTIES: "FORBIDDEN",
  LEGAL_HOLD_ACTIVE: "VERSION_CONFLICT",
  DISPOSAL_STATE_INVALID: "VERSION_CONFLICT",
  OFFBOARDING_STATE_INVALID: "VERSION_CONFLICT",
};

export function newCorrelationId(): string {
  return randomUUID();
}

export function errorResponse(err: unknown, correlationId: string): Response {
  if (err instanceof DomainError) {
    const code = DOMAIN_TO_API[err.code] ?? "VALIDATION_FAILED";
    return Response.json({ ...toApiError(code, correlationId), detail: err.message }, { status: err.status });
  }
  if (err instanceof ConfigError) {
    return Response.json(toApiError("SERVICE_UNAVAILABLE", correlationId), { status: statusFor("SERVICE_UNAVAILABLE") });
  }
  // Ayrıntı (SQL, stack) istemciye verilmez; yalnızca kayıt için düzeltme kimliği.
  console.error(`[api] iç hata cid=${correlationId}`);
  return Response.json(toApiError("INTERNAL", correlationId), { status: statusFor("INTERNAL") });
}

/** Aynı-köken: Origin, Host ile eşleşmelidir. Origin yoksa reddedilir. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function isSecureRequest(req: Request): boolean {
  return new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
}

export function sessionCookie(req: Request, value: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${String(maxAge)}${isSecureRequest(req) ? "; Secure" : ""}`;
}

export function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}
