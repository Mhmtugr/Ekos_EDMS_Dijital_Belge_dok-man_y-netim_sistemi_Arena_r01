// Sözleşme listesi ve detayı (Faz 5, madde 4-5 için). Tüm sorgular belge görünürlüğü filtresinden geçer.
import { Prisma, type PrismaClient } from "@prisma/client";
import type { ActorContext } from "@ekos/core";
import { documentVisibilitySql } from "../documents/visibility.js";
import { DomainError } from "../documents/shared.js";


export interface ContractListFilters {
  readonly q?: string | undefined;
  readonly counterpartyId?: string | undefined;
  readonly endFrom?: string | undefined; // YYYY-MM-DD
  readonly endTo?: string | undefined;
  readonly page?: number | undefined;
  readonly pageSize?: number | undefined;
}

export interface ContractListRow {
  id: string;
  documentId: string;
  number: string;
  title: string;
  institutionalNo: string | null;
  contractType: string;
  counterpartyName: string;
  contractStatus: string | null;
  endDate: string | null;
  autoRenewal: boolean | null;
  amount: string | null;
  currency: string | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function listContracts(
  prisma: PrismaClient,
  input: { actor: ActorContext; now: Date } & ContractListFilters,
): Promise<{ items: ContractListRow[]; total: number; page: number; pageSize: number }> {
  if (input.endFrom && !DAY.test(input.endFrom)) throw new DomainError("VALIDATION_FAILED", "Başlangıç tarihi biçimi YYYY-AA-GG olmalı");
  if (input.endTo && !DAY.test(input.endTo)) throw new DomainError("VALIDATION_FAILED", "Bitiş tarihi biçimi YYYY-AA-GG olmalı");
  const pageSize = Math.min(Math.max(input.pageSize ?? 25, 1), 100);
  const page = Math.max(input.page ?? 1, 1);
  const q = input.q?.trim().slice(0, 100) ?? "";
  const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  const conds: Prisma.Sql[] = [documentVisibilitySql(input.actor, input.now)];
  if (q) conds.push(Prisma.sql`(c."title" ILIKE ${like} OR c."institutionalNo" ILIKE ${like} OR d."number" ILIKE ${like})`);
  if (input.counterpartyId) conds.push(Prisma.sql`c."counterpartyId" = ${input.counterpartyId}::uuid`);
  if (input.endFrom) conds.push(Prisma.sql`c."endDate" >= ${input.endFrom}::date`);
  if (input.endTo) conds.push(Prisma.sql`c."endDate" <= ${input.endTo}::date`);
  const where = Prisma.join(conds, " AND ");

  const [countRow] = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM "ContractRecord" c JOIN "Document" d ON d."id" = c."documentId" WHERE ${where}`;
  const rows = await prisma.$queryRaw<{
    id: string; documentId: string; number: string; title: string; institutionalNo: string | null; contractType: string;
    counterpartyName: string; contractStatus: string | null; endDate: Date | null; autoRenewal: boolean | null; amount: Prisma.Decimal | null; currency: string | null;
  }[]>`
    SELECT c."id", c."documentId", d."number", c."title", c."institutionalNo", c."contractType",
           cp."officialName" AS "counterpartyName", d."contractStatus"::text AS "contractStatus",
           c."endDate", c."autoRenewal", c."amount", c."currency"
    FROM "ContractRecord" c
    JOIN "Document" d ON d."id" = c."documentId"
    JOIN "Counterparty" cp ON cp."id" = c."counterpartyId"
    WHERE ${where}
    ORDER BY c."endDate" ASC NULLS LAST, c."id" ASC
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
  return {
    total: countRow?.n ?? 0,
    page,
    pageSize,
    items: rows.map((r) => ({
      id: r.id,
      documentId: r.documentId,
      number: r.number,
      title: r.title,
      institutionalNo: r.institutionalNo,
      contractType: r.contractType,
      counterpartyName: r.counterpartyName,
      contractStatus: r.contractStatus,
      endDate: r.endDate ? r.endDate.toISOString().slice(0, 10) : null,
      autoRenewal: r.autoRenewal,
      amount: r.amount ? r.amount.toString() : null,
      currency: r.currency,
    })),
  };
}

export async function getContractDetail(prisma: PrismaClient, input: { actor: ActorContext; now: Date; contractId: string }) {
  const visible = await prisma.$queryRaw<{ id: string }[]>`
    SELECT c."id" FROM "ContractRecord" c JOIN "Document" d ON d."id" = c."documentId"
    WHERE c."id" = ${input.contractId}::uuid AND ${documentVisibilitySql(input.actor, input.now)}`;
  if (visible.length === 0) throw new DomainError("NOT_FOUND");
  const c = await prisma.contractRecord.findUniqueOrThrow({
    where: { id: input.contractId },
    include: {
      document: { select: { id: true, number: true, title: true, contractStatus: true, ownerId: true } },
      counterparty: { select: { officialName: true } },
      legalEntity: { select: { name: true } },
      obligations: { orderBy: { createdAt: "asc" }, select: { id: true, description: true, dueDate: true, status: true, responsibleUserId: true, rowVersion: true } },
      guarantees: { orderBy: { createdAt: "asc" }, select: { id: true, guaranteeType: true, expiresAt: true, returnedAt: true, issuer: true, referenceNo: true, amount: true, currency: true } },
    },
  });
  const instance = await prisma.workflowInstance.findFirst({
    where: { subjectType: "CONTRACT", subjectId: c.id },
    orderBy: { startedAt: "desc" },
    include: {
      definitionVersion: { select: { definitionRef: { select: { code: true } } } },
      steps: {
        orderBy: { orderIndex: "asc" },
        include: { tasks: { orderBy: { createdAt: "asc" }, include: { assignee: { select: { displayName: true } }, decision: { select: { decision: true, decidedAt: true } } } } },
      },
    },
  });
  return { contract: c, workflow: instance };
}

