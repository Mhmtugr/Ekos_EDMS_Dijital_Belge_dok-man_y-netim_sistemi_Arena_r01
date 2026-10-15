import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, otpauthUri, totpAt, verifyTotp } from "./totp.js";

// RFC 6238 Ek B — SHA1 test secret "12345678901234567890" (ASCII). RFC 8 haneli değerler verir;
// 6 haneli karşılıklar son 6 haneleridir.
const SECRET = new TextEncoder().encode("12345678901234567890");
const RFC_VECTORS: [number, string][] = [
  [59, "287082"],
  [1111111109, "081804"],
  [1111111111, "050471"],
  [1234567890, "005924"],
  [2000000000, "279037"],
];

describe("TOTP (RFC 6238)", () => {
  it.each(RFC_VECTORS)("T=%i için RFC değeri %s", (t, expected) => {
    expect(totpAt(SECRET, t)).toBe(expected);
  });

  it("pencere içindeki kodu kabul eder ve eşleşen adımı döner", () => {
    const t = 1111111111;
    expect(verifyTotp(SECRET, "050471", t)).toBe(Math.floor(t / 30));
    const next = totpAt(SECRET, t + 30);
    expect(verifyTotp(SECRET, next, t)).toBe(Math.floor(t / 30) + 1);
  });

  it("pencere dışındaki kod reddedilir", () => {
    const t = 1111111111;
    expect(verifyTotp(SECRET, totpAt(SECRET, t + 300), t)).toBeNull();
  });

  it("biçimi bozuk kodlar reddedilir (harf, kısa, uzun)", () => {
    expect(verifyTotp(SECRET, "12345a", 59)).toBeNull();
    expect(verifyTotp(SECRET, "12345", 59)).toBeNull();
    expect(verifyTotp(SECRET, "1234567", 59)).toBeNull();
  });

  it("base32 RFC 4648 örneği ve gidiş-dönüş", () => {
    expect(base32Encode(new TextEncoder().encode("foobar"))).toBe("MZXW6YTBOI");
    expect(new TextDecoder().decode(base32Decode("MZXW6YTBOI"))).toBe("foobar");
  });

  it("base32 geçersiz karakterde hata verir", () => {
    expect(() => base32Decode("ABC1")).toThrow();
  });

  it("otpauth URI standart alanları içerir", () => {
    const uri = otpauthUri("EKOS EDMS", "ali@ekos.test", SECRET);
    expect(uri.startsWith("otpauth://totp/EKOS%20EDMS%3Aali%40ekos.test?")).toBe(true);
    expect(uri).toContain("algorithm=SHA1");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });
});
