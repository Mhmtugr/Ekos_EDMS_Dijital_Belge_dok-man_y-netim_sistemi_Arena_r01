// argon2id parola karması (ADR-0003). Native modül yalnızca web sunucusunda yüklenir (serverExternalPackages).
import { hash, verify } from "@node-rs/argon2";
import type { PasswordHasher } from "@ekos/db";

export const passwordHasher: PasswordHasher = {
  hash: (password) => hash(password),
  verify: (stored, password) => verify(stored, password),
};
