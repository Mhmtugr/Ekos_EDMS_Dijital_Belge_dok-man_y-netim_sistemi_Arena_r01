import { describe, expect, it } from "vitest";
import { validatePassword } from "./password.js";

describe("validatePassword", () => {
  it("12+ karakter ve e-posta yerel kısmı içermeyen parola kabul edilir", () => {
    expect(validatePassword("gucluParola-2026", "ali.yilmaz@ekos.test")).toEqual([]);
  });
  it("kısa parola reddedilir", () => {
    expect(validatePassword("kisa", "a@b.test")).toContain("TOO_SHORT");
  });
  it("e-posta yerel kısmını içeren parola reddedilir (büyük/küçük harf fark etmez)", () => {
    expect(validatePassword("ALI.YILMAZ-2026!!", "ali.yilmaz@ekos.test")).toContain(
      "CONTAINS_EMAIL_LOCAL_PART",
    );
  });
  it("tek karakter tekrarı reddedilir", () => {
    expect(validatePassword("aaaaaaaaaaaaaaaa", "x@y.test")).toContain("REPEATED_SINGLE_CHARACTER");
  });
  it("çok uzun parola reddedilir", () => {
    expect(validatePassword("a".repeat(129) + "b", "x@y.test")).toContain("TOO_LONG");
  });
});
