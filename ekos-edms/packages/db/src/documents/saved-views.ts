// Kayıtlı arama görünümleri (Faz 2, madde 8). Yalnızca sahibi görür/değiştirir.
import type { PrismaClient } from "@prisma/client";
import { DomainError } from "./shared.js";

export interface SavedCriteria {
  readonly query: string;
  readonly typeCode?: string;
  readonly ingestStatus?: string;
  readonly confidentiality?: string;
}

export async function createSavedView(prisma: PrismaClient, input: { readonly ownerId: string; readonly name: string; readonly criteria: SavedCriteria }) {
  const name = input.name.trim();
  if (name.length === 0 || name.length > 120) throw new DomainError("METADATA_INVALID", "Görünüm adı 1–120 karakter olmalıdır");
  if (input.criteria.query.trim().length === 0) throw new DomainError("METADATA_INVALID", "Arama metni boş olamaz");
  const dup = await prisma.savedView.findFirst({ where: { ownerId: input.ownerId, name } });
  if (dup) throw new DomainError("SAVED_VIEW_DUPLICATE", "Bu adla bir görünümünüz zaten var");
  return prisma.savedView.create({
    data: { ownerId: input.ownerId, name, criteria: { ...input.criteria } as never, updatedAt: new Date() },
    select: { id: true, name: true, criteria: true, rowVersion: true },
  });
}

export async function listSavedViews(prisma: PrismaClient, ownerId: string) {
  return prisma.savedView.findMany({ where: { ownerId }, orderBy: { name: "asc" }, select: { id: true, name: true, criteria: true, rowVersion: true } });
}

export async function deleteSavedView(prisma: PrismaClient, input: { readonly ownerId: string; readonly viewId: string }): Promise<void> {
  const res = await prisma.savedView.deleteMany({ where: { id: input.viewId, ownerId: input.ownerId } });
  if (res.count === 0) throw new DomainError("NOT_FOUND");
}
