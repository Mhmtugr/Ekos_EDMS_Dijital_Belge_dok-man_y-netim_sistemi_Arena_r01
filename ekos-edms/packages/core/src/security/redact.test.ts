import { describe, expect, it } from "vitest";
import { REDACTED, redact } from "./redact.js";

describe("redact", () => {
  it("hassas anahtarları maskeler (iç içe ve dizi içinde dahil)", () => {
    const out = redact({
      email: "a@x.test",
      passwordHash: "$argon2id$...",
      nested: { totpSecretCiphertext: "abc", ok: 1 },
      list: [{ sessionToken: "t" }],
      ocrText: "gizli belge",
      content: "belge",
    });
    expect(out).toEqual({
      email: "a@x.test",
      passwordHash: REDACTED,
      nested: { totpSecretCiphertext: REDACTED, ok: 1 },
      list: [{ sessionToken: REDACTED }],
      ocrText: REDACTED,
      content: REDACTED,
    });
  });

  it("Date ve düz değerleri değiştirmez", () => {
    const d = new Date("2026-01-01T00:00:00Z");
    expect(redact({ at: d, n: 3 })).toEqual({ at: d, n: 3 });
  });

  it("girdi nesnesini değiştirmez", () => {
    const input = { password: "x" };
    redact(input);
    expect(input.password).toBe("x");
  });
});
