// Yetim karantina kayıtları (Faz 2 eksiği). KARAR: silinmez, raporlanır.
// Gerekçe: DocumentFileObject için DB tetikleyicisi (0003 ekos_guard_file_object) silmeyi reddeder
// ("saklama ve denetim izi"). Silme, Faz 4 saklama/imha akışında ayrı, denetlenen bir süreçle yapılır.
// Bu fonksiyon yetim adayları listeler: hiçbir sürüme, içe aktarmaya veya OCR işine bağlı olmayan,
// hiç taranmamış (PENDING) ve eşik süresinden eski karantina dosyaları. INFECTED kayıtlar delil olarak listelenmez.
import type { PrismaClient } from "@prisma/client";

export interface OrphanQuarantineItem {
  readonly fileObjectId: string;
  readonly sha256: string;
  readonly createdAt: Date;
}

export async function findOrphanQuarantine(prisma: PrismaClient, olderThan: Date): Promise<OrphanQuarantineItem[]> {
  const rows = await prisma.documentFileObject.findMany({
    where: {
      storagePrefix: "quarantine",
      scanStatus: "PENDING",
      createdAt: { lt: olderThan },
      version: { is: null },
      importBatches: { none: {} },
      ocrJobs: { none: {} },
    },
    select: { id: true, sha256: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({ fileObjectId: r.id, sha256: r.sha256, createdAt: r.createdAt }));
}
