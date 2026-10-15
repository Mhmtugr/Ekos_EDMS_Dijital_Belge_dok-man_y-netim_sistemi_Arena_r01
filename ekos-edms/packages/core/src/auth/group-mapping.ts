// IdP (Entra ID) grup → rol eşlemesi. Eşleme yoksa rol yoktur; yetki motoru varsayılan red uygular.
export interface IdpGroupMapping {
  readonly externalGroupId: string;
  readonly roleCode: string;
}

export function resolveRoleCodes(
  externalGroupIds: readonly string[],
  mappings: readonly IdpGroupMapping[],
): string[] {
  const groups = new Set(externalGroupIds);
  const roles = new Set<string>();
  for (const m of mappings) {
    if (groups.has(m.externalGroupId)) roles.add(m.roleCode);
  }
  return [...roles].sort();
}
