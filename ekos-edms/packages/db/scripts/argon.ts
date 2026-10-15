// Geliştirme betikleri için argon2id (uygulamadaki apps/web/lib/server/passwords.ts ile aynı kütüphane).
import { hash, verify } from "@node-rs/argon2";
export const argon2Hash = (password: string): Promise<string> => hash(password);
export const argon2Verify = (stored: string, password: string): Promise<boolean> => verify(stored, password);
