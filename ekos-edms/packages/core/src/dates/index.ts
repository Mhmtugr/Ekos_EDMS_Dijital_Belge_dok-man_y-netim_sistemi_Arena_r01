// Tarih yardımcıları — Faz 3'te (yenileme/ihbar hesaplama) doldurulacak.
// Kural (A4/Faz 3): iş günü ve tatil takvimi yapılandırılmadan hesaplama desteklenmez;
// belirsiz hüküm NEEDS_MANUAL_VERIFICATION üretir. Bu dosyada henüz fonksiyon yoktur.

/** Tarih-yalnızca anlamı için kullanılan biçim (YYYY-MM-DD). Saat dilimi taşımaz. */
export type CalendarDate = `${number}-${number}-${number}`;

/** Ayrılmış tanı kodu: hesaplama güvenle yapılamadığında kullanılır. */
export const NEEDS_MANUAL_VERIFICATION = "NEEDS_MANUAL_VERIFICATION" as const;
