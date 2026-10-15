// Test sahteleri: bellek deposu, sahte AV ve sahte OCR. Gerçek dış sistemler DEĞİLDİR (DOĞRULANMADI olarak raporlanır).
import type { AntivirusPort, ObjectStoragePort, OcrOutcome, OcrPort, ScanVerdict } from "@ekos/core";

export class MemStorage implements ObjectStoragePort {
  readonly map = new Map<string, Uint8Array>();
  put(key: string, bytes: Uint8Array): Promise<void> {
    if (!/^(quarantine|objects)\//.test(key)) return Promise.reject(new Error("prefix"));
    if (this.map.has(key)) return Promise.reject(new Error("exists"));
    this.map.set(key, bytes);
    return Promise.resolve();
  }
  get(key: string): Promise<Uint8Array> {
    const v = this.map.get(key);
    return v ? Promise.resolve(v) : Promise.reject(new Error("missing " + key));
  }
  exists(key: string): Promise<boolean> {
    return Promise.resolve(this.map.has(key));
  }
  delete(key: string): Promise<void> {
    this.map.delete(key);
    return Promise.resolve();
  }
  move(from: string, to: string): Promise<void> {
    if (this.map.has(to)) return Promise.reject(new Error("target exists"));
    const v = this.map.get(from);
    if (!v) return Promise.reject(new Error("missing " + from));
    this.map.set(to, v);
    this.map.delete(from);
    return Promise.resolve();
  }
}

export class FakeAv implements AntivirusPort {
  next: ScanVerdict = { status: "CLEAN" };
  scan(): Promise<ScanVerdict> {
    return Promise.resolve(this.next);
  }
}

export class FakeOcr implements OcrPort {
  next: OcrOutcome = { status: "OK", languages: "tur+eng", pages: [{ page: 1, text: "Sözleşme metni burada", confidence: 0.9 }] };
  calls = 0;
  recognize(): Promise<OcrOutcome> {
    this.calls += 1;
    return Promise.resolve(this.next);
  }
}
