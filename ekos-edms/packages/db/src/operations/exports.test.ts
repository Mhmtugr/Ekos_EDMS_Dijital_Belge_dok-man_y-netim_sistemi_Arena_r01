import { describe, expect, it } from "vitest";
import { buildZip, crc32, toCsv, toXlsx } from "./exports.js";

const dec = (b: Uint8Array) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(b);

/** Test amaçlı zip okuyucu (store yöntemi): merkezi dizinden girdileri çıkarır. */
function readZip(buf: Uint8Array): Record<string, string> {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  expect(eocd).toBeGreaterThanOrEqual(0);
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out: Record<string, string> = {};
  for (let k = 0; k < count; k++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const method = v.getUint16(p + 10, true);
    expect(method).toBe(0);
    const size = v.getUint32(p + 20, true);
    const crc = v.getUint32(p + 16, true);
    const nlen = v.getUint16(p + 28, true);
    const elen = v.getUint16(p + 30, true);
    const clen = v.getUint16(p + 32, true);
    const loc = v.getUint32(p + 42, true);
    const name = dec(buf.subarray(p + 46, p + 46 + nlen));
    const lnlen = v.getUint16(loc + 26, true);
    const lelen = v.getUint16(loc + 28, true);
    const data = buf.subarray(loc + 30 + lnlen + lelen, loc + 30 + lnlen + lelen + size);
    expect(crc32(data)).toBe(crc);
    out[name] = dec(data);
    p += 46 + nlen + elen + clen;
  }
  return out;
}

describe("crc32", () => {
  it("bilinen IEEE değeri: '123456789' → CBF43926", () => {
    expect(crc32(new TextEncoder().encode("123456789")).toString(16).toUpperCase()).toBe("CBF43926");
  });
});

describe("toCsv", () => {
  it("UTF-8 BOM, RFC 4180 kaçışı ve formül enjeksiyonu koruması", () => {
    const text = dec(toCsv([["a,b", 'say "x"', "=HYPERLINK(1)"], ["ç ş ğ", null, 42], ["line\nbreak", "-5", "@x"]]));
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const body = text.slice(1);
    expect(body).toContain('"a,b","say ""x""",\'=HYPERLINK(1)');
    expect(body).toContain("ç ş ğ,,42");
    expect(body).toContain("\"line\nbreak\",'-5,'@x");
    expect(body.endsWith("\r\n")).toBe(true);
  });
});

describe("toXlsx", () => {
  it("geçerli OOXML paketi: içerik, sayfa ve hücre değerleri geri okunur", () => {
    const xlsx = toXlsx([["Başlık", "Tutar & <not>"], ["=SUM(A1)", 1250.5], [null, "ğüşıö"]]);
    const files = readZip(xlsx);
    expect(Object.keys(files).sort()).toEqual(
      ["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/workbook.xml", "xl/worksheets/sheet1.xml"].sort(),
    );
    const sheet = files["xl/worksheets/sheet1.xml"] ?? "";
    expect(sheet).toContain('<c r="A1" t="inlineStr"><is><t xml:space="preserve">Başlık</t></is></c>');
    expect(sheet).toContain("Tutar &amp; &lt;not&gt;");
    expect(sheet).toContain("&apos;=SUM(A1)");
    expect(sheet).toContain('<c r="B2"><v>1250.5</v></c>');
    // null hücre: referans hiç üretilmez (boş hücre)
    expect(sheet).not.toContain('r="A3"');
    expect(sheet).toContain('<c r="B3" t="inlineStr"><is><t xml:space="preserve">ğüşıö</t>');
    expect(files["xl/workbook.xml"]).toContain('name="Rapor"');
  });

  it("geçersiz XML denetim karakterlerini temizler", () => {
    const files = readZip(toXlsx([["a\u0001b"]]));
    expect(files["xl/worksheets/sheet1.xml"]).toContain("<t xml:space=\"preserve\">ab</t>");
  });
});

describe("buildZip", () => {
  it("birden çok girdiyi geri okur", () => {
    const enc = new TextEncoder();
    const files = readZip(buildZip([{ name: "a.txt", data: enc.encode("merhaba") }, { name: "dir/b.txt", data: enc.encode("") }]));
    expect(files).toEqual({ "a.txt": "merhaba", "dir/b.txt": "" });
  });
});
