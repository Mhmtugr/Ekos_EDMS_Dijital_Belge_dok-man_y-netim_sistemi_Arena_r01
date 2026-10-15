// Yerel dosya sistemi nesne deposu. Geliştirme ve test için; üretimde S3/MinIO adaptörü (Faz 2 sonrası, DOĞRULANMADI).
import { mkdir, readFile, stat, writeFile, link, unlink } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import type { ObjectStoragePort } from "@ekos/core";

const KEY_RE = /^(quarantine|objects)\/[A-Za-z0-9_-]{1,120}$/;

export function assertStorageKey(key: string): void {
  if (!KEY_RE.test(key)) throw new Error("Geçersiz depolama anahtarı");
}

export class FsObjectStorage implements ObjectStoragePort {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathFor(key: string): string {
    assertStorageKey(key);
    const full = resolve(join(this.root, key));
    if (!full.startsWith(this.root + sep)) throw new Error("Yol kökün dışına çıkıyor");
    return full;
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(tmp, bytes, { flag: "wx" });
    try {
      // link: hedef varsa başarısız olur (üzerine yazma yok).
      await link(tmp, target);
    } finally {
      await unlink(tmp);
    }
  }

  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.pathFor(key)));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  async move(fromKey: string, toKey: string): Promise<void> {
    const from = this.pathFor(fromKey);
    const to = this.pathFor(toKey);
    await mkdir(dirname(to), { recursive: true });
    // link + unlink: hedef varsa EEXIST ile durur (rename üzerine yazardı).
    await link(from, to);
    await unlink(from);
  }
}
