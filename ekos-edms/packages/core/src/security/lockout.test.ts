import { describe, expect, it } from "vitest";
import { isLocked, onFailedLogin, onSuccessfulLogin, type LockoutPolicy, type LockoutState } from "./lockout.js";

const policy: LockoutPolicy = { maxFailures: 3, lockMinutes: 10 };
const T0 = new Date("2026-10-13T09:00:00Z");

describe("kilitleme politikası", () => {
  it("eşiğe kadar kilit yoktur", () => {
    let s: LockoutState = { failedCount: 0, lockedUntil: null };
    s = onFailedLogin(s, T0, policy);
    s = onFailedLogin(s, T0, policy);
    expect(s.failedCount).toBe(2);
    expect(isLocked(s, T0)).toBe(false);
  });

  it("eşikte kilitlenir ve süre dakika cinsinden hesaplanır", () => {
    let s: LockoutState = { failedCount: 0, lockedUntil: null };
    for (let i = 0; i < 3; i++) s = onFailedLogin(s, T0, policy);
    expect(s.lockedUntil?.toISOString()).toBe("2026-10-13T09:10:00.000Z");
    expect(isLocked(s, T0)).toBe(true);
  });

  it("süre dolunca kilit kalkar ve sayaç yeniden başlar", () => {
    const locked: LockoutState = { failedCount: 0, lockedUntil: new Date("2026-10-13T09:10:00Z") };
    const later = new Date("2026-10-13T09:11:00Z");
    expect(isLocked(locked, later)).toBe(false);
    expect(onFailedLogin(locked, later, policy).failedCount).toBe(1);
  });

  it("başarılı giriş sayacı sıfırlar", () => {
    expect(onSuccessfulLogin()).toEqual({ failedCount: 0, lockedUntil: null });
  });
});
