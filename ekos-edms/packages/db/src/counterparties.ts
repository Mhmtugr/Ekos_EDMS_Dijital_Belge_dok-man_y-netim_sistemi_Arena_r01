// Karşı taraf (tedarikçi/müşteri) servisi. Yetki rota katmanında (counterparty.manage) denetlenir.
import { appendAudit } from "./audit.js";
import { DomainError } from "./documents/shared.js";
import type { Prisma, PrismaClient } from "@prisma/client";

export interface CounterpartyOption {
  readonly id: string;
  readonly officialName: string;
  readonly countryCode: string;
}

export async function listActiveCounterparties(prisma: PrismaClient): Promise<CounterpartyOption[]> {
  return prisma.counterparty.findMany({
    where: { status: "ACTIVE" },
    orderBy: { officialName: "asc" },
    select: { id: true, officialName: true, countryCode: true },
    take: 1000,
  });
}

export interface CreateCounterpartyInput {
  readonly actorId: string;
  readonly correlationId: string;
  readonly officialName: string;
  readonly countryCode: string;
  readonly supplierCode?: string | null;
}

export async function createCounterparty(prisma: PrismaClient, input: CreateCounterpartyInput): Promise<{ id: string }> {
  const officialName = input.officialName.trim();
  const countryCode = input.countryCode.trim().toUpperCase();
  const supplierCode = input.supplierCode?.trim() ? input.supplierCode.trim() : null;
  if (officialName.length < 2 || officialName.length > 300) throw new DomainError("METADATA_INVALID", "Resmi ad 2–300 karakter olmalıdır");
  if (!/^[A-Z]{2}$/.test(countryCode)) throw new DomainError("METADATA_INVALID", "Ülke kodu ISO 3166-1 alpha-2 olmalıdır (ör. TR)");
  if (supplierCode !== null && supplierCode.length > 60) throw new DomainError("METADATA_INVALID", "Tedarikçi kodu en fazla 60 karakter");
  return prisma.$transaction(async (tx) => {
    if (supplierCode !== null) {
      const dup = await tx.counterparty.findUnique({ where: { supplierCode }, select: { id: true } });
      if (dup) throw new DomainError("METADATA_INVALID", "Bu tedarikçi kodu zaten kayıtlı");
    }
    const data: Prisma.CounterpartyUncheckedCreateInput = {
      officialName,
      countryCode,
      supplierCode,
      status: "ACTIVE",
      createdBy: input.actorId,
      updatedBy: input.actorId,
    };
    const cp = await tx.counterparty.create({ data, select: { id: true } });
    await appendAudit(tx, {
      actorType: "USER",
      actorId: input.actorId,
      eventType: "COUNTERPARTY_CREATED",
      targetType: "Counterparty",
      targetId: cp.id,
      outcome: "SUCCESS",
      correlationId: input.correlationId,
      afterSummary: { countryCode, hasSupplierCode: supplierCode !== null },
    });
    return cp;
  });
}
