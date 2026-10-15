// Hesap kilitleme politikası (saf). Değerler yapılandırılabilir; hukuki/politika değeri DEĞİLDİR.
export interface LockoutPolicy {
  /** Kilitleme öncesi ardışık başarısız deneme sayısı. */
  readonly maxFailures: number;
  /** Kilit süresi (dakika). */
  readonly lockMinutes: number;
}

export interface LockoutState {
  readonly failedCount: number;
  readonly lockedUntil: Date | null;
}

export const DEFAULT_LOCKOUT_POLICY: LockoutPolicy = { maxFailures: 5, lockMinutes: 15 };

export function isLocked(state: LockoutState, now: Date): boolean {
  return state.lockedUntil !== null && state.lockedUntil.getTime() > now.getTime();
}

export function onFailedLogin(state: LockoutState, now: Date, policy: LockoutPolicy): LockoutState {
  // Kilit süresi dolmuşsa sayaç sıfırdan başlar.
  const expired = state.lockedUntil !== null && state.lockedUntil.getTime() <= now.getTime();
  const failedCount = (expired ? 0 : state.failedCount) + 1;
  if (failedCount >= policy.maxFailures) {
    return { failedCount: 0, lockedUntil: new Date(now.getTime() + policy.lockMinutes * 60_000) };
  }
  return { failedCount, lockedUntil: null };
}

export function onSuccessfulLogin(): LockoutState {
  return { failedCount: 0, lockedUntil: null };
}
