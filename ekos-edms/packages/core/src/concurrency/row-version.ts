// Eşzamanlı düzenleme (ADR-0006, Faz 2 madde 10). Güncelleme, istemcinin bildiği rowVersion ile
// veritabanındaki güncel değer eşleşiyorsa kabul edilir; aksi halde 409 VERSION_CONFLICT.
export type RowVersionResult =
  | { readonly ok: true; readonly nextRowVersion: number }
  | { readonly ok: false; readonly status: 409; readonly code: "VERSION_CONFLICT" };

export function checkRowVersion(currentRowVersion: number, expectedRowVersion: number): RowVersionResult {
  if (!Number.isInteger(currentRowVersion) || !Number.isInteger(expectedRowVersion)) {
    throw new Error("rowVersion tam sayı olmalı");
  }
  if (currentRowVersion !== expectedRowVersion) {
    return { ok: false, status: 409, code: "VERSION_CONFLICT" };
  }
  return { ok: true, nextRowVersion: currentRowVersion + 1 };
}
