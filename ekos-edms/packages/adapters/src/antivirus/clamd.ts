// ClamAV (clamd) INSTREAM protokolü (TCP). Belirsiz her durum UNAVAILABLE'dır; asla CLEAN üretmez.
import { connect, type Socket } from "node:net";
import type { AntivirusPort, ScanVerdict } from "@ekos/core";

export interface ClamdOptions {
  readonly host: string;
  readonly port: number;
  readonly timeoutMs: number;
  /** clamd StreamMaxLength altında kalmak için parça boyutu. */
  readonly chunkSize?: number;
}

export function encodeInstream(bytes: Uint8Array, chunkSize = 2048): Buffer {
  const parts: Buffer[] = [Buffer.from("zINSTREAM\0", "ascii")];
  for (let off = 0; off < bytes.length; off += chunkSize) {
    const chunk = bytes.subarray(off, Math.min(off + chunkSize, bytes.length));
    const len = Buffer.alloc(4);
    len.writeUInt32BE(chunk.length, 0);
    parts.push(len, Buffer.from(chunk));
  }
  parts.push(Buffer.alloc(4)); // 0 uzunluklu bitiş
  return Buffer.concat(parts);
}

/** clamd yanıtını yorumlar. Tanınmayan yanıt UNAVAILABLE'dır. */
export function parseClamdReply(reply: string): ScanVerdict {
  const line = reply.replace(/\0+$/, "").trim();
  if (/^stream: OK$/.test(line)) return { status: "CLEAN" };
  const found = /^stream: (.+) FOUND$/.exec(line);
  if (found?.[1]) return { status: "INFECTED", signature: found[1] };
  return { status: "UNAVAILABLE", reason: "CLAMD_UNEXPECTED_REPLY" };
}

export class ClamdAntivirus implements AntivirusPort {
  constructor(private readonly opts: ClamdOptions) {}

  scan(bytes: Uint8Array): Promise<ScanVerdict> {
    const payload = encodeInstream(bytes, this.opts.chunkSize ?? 2048);
    return new Promise<ScanVerdict>((resolvePromise) => {
      let settled = false;
      let reply = "";
      const finish = (v: ScanVerdict, sock?: Socket): void => {
        if (settled) return;
        settled = true;
        sock?.destroy();
        resolvePromise(v);
      };
      const sock = connect({ host: this.opts.host, port: this.opts.port });
      sock.setTimeout(this.opts.timeoutMs);
      sock.on("connect", () => {
        sock.write(payload);
      });
      sock.on("data", (d: Buffer) => {
        reply += d.toString("utf8");
        if (reply.includes("\0")) finish(parseClamdReply(reply), sock);
      });
      sock.on("end", () => {
        finish(reply.length > 0 ? parseClamdReply(reply) : { status: "UNAVAILABLE", reason: "CLAMD_EMPTY_REPLY" }, sock);
      });
      sock.on("timeout", () => { finish({ status: "UNAVAILABLE", reason: "CLAMD_TIMEOUT" }, sock); });
      sock.on("error", () => { finish({ status: "UNAVAILABLE", reason: "CLAMD_CONNECTION_FAILED" }, sock); });
    });
  }
}
