// Standart hata biçimi (A5/7): { code, message, correlationId }. Secret, SQL, stack trace, belge içeriği YOK.
export const API_ERROR_STATUS = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  CSRF_REJECTED: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  POLICY_MISSING: 422,
  IDP_NOT_CONFIGURED: 503,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL: 500,
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_STATUS;

export interface ApiErrorBody {
  readonly code: ApiErrorCode;
  readonly message: string;
  readonly correlationId: string;
}

const SAFE_MESSAGES_TR: Record<ApiErrorCode, string> = {
  VALIDATION_FAILED: "Girdi doğrulanamadı.",
  UNAUTHENTICATED: "Oturum gerekli.",
  INVALID_CREDENTIALS: "Kullanıcı adı veya parola hatalı.",
  FORBIDDEN: "Bu işlem için yetkiniz yok.",
  CSRF_REJECTED: "İstek doğrulanamadı.",
  NOT_FOUND: "Kayıt bulunamadı.",
  VERSION_CONFLICT: "Kayıt başka biri tarafından değiştirildi. Lütfen yeniden yükleyin.",
  IDEMPOTENCY_CONFLICT: "Bu istek daha önce farklı içerikle işlendi.",
  PAYLOAD_TOO_LARGE: "İstek boyutu sınırı aşıldı.",
  RATE_LIMITED: "Çok fazla istek. Lütfen bir süre sonra tekrar deneyin.",
  POLICY_MISSING: "Politika eksik: bu işlem için yapılandırma gerekir.",
  IDP_NOT_CONFIGURED: "Kurumsal giriş (SSO) yapılandırılmadı.",
  SERVICE_UNAVAILABLE: "Hizmet şu anda kullanılamıyor.",
  INTERNAL: "Beklenmeyen bir hata oluştu.",
};

export function toApiError(code: ApiErrorCode, correlationId: string): ApiErrorBody {
  return { code, message: SAFE_MESSAGES_TR[code], correlationId };
}

export function statusFor(code: ApiErrorCode): number {
  return API_ERROR_STATUS[code];
}
