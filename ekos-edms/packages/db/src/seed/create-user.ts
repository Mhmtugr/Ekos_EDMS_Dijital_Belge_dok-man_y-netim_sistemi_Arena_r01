// Yerel kullanıcı oluşturma. Parola çağıran tarafından verilir; komut satırında parola YOKTUR.
import type { PrismaClient } from "@prisma/client";
import type { PasswordHasher } from "../auth/local.js";

export async function createLocalUser(
  prisma: PrismaClient,
  hasher: PasswordHasher,
  input: {
    readonly email: string;
    readonly displayName: string;
    readonly password: string;
    readonly roleCode: string;
    /** Kapsam dizileri. Kurum geneli erişim için açıkça `organizationWide: true` verilmelidir. */
    readonly scope?: { readonly departmentIds?: readonly string[]; readonly documentTypeIds?: readonly string[]; readonly counterpartyIds?: readonly string[]; readonly projectIds?: readonly string[] };
    readonly organizationWide?: boolean;
  },
): Promise<{ userId: string }> {
  const email = input.email.trim().toLowerCase();
  const role = await prisma.role.findUnique({ where: { code: input.roleCode } });
  if (!role) throw new Error(`Rol bulunamadı: ${input.roleCode}`);
  // Boş kapsam = KISIT YOK (PERMISSIONS.md). Bu yüzden kapsam açıkça verilmeden kullanıcı oluşturulmaz.
  const scoped = input.roleCode !== "PLATFORM_ADMIN";
  const hasScope = [input.scope?.departmentIds, input.scope?.documentTypeIds, input.scope?.counterpartyIds, input.scope?.projectIds].some((v) => (v?.length ?? 0) > 0);
  if (scoped && !hasScope && input.organizationWide !== true) {
    throw new Error("Kapsam belirtilmedi: bu rol için departman/tür/karşı taraf/proje kapsamı verin veya kurum geneli erişimi açıkça onaylayın (organizationWide)");
  }
  const passwordHash = await hasher.hash(input.password);
  const user = await prisma.user.create({
    data: { email, displayName: input.displayName, passwordHash, status: "ACTIVE" },
  });
  await prisma.membership.create({
    data: {
      userId: user.id,
      roleId: role.id,
      departmentIds: [...(input.scope?.departmentIds ?? [])],
      documentTypeIds: [...(input.scope?.documentTypeIds ?? [])],
      counterpartyIds: [...(input.scope?.counterpartyIds ?? [])],
      projectIds: [...(input.scope?.projectIds ?? [])],
    },
  });
  return { userId: user.id };
}
