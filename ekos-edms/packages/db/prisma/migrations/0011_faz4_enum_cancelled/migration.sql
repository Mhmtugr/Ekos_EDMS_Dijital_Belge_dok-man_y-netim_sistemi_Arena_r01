-- 0011_faz4_enum_cancelled — OffboardingCaseStatus enum'una CANCELLED değeri.
-- PostgreSQL, yeni enum değerini aynı işlemde kullanmaya izin vermez; bu nedenle ayrı migrasyondur.
-- El yazımıdır; sırayı değiştirmeyin.

ALTER TYPE "OffboardingCaseStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
