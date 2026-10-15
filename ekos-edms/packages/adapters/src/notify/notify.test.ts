// Bildirim göndericileri: Teams web kancası (gerçek yerel HTTP sunucusu) ve SMTP alıcı doğrulaması.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SmtpSender, TeamsSender } from "./index.js";

let server: Server;
let base = "";
let nextStatus = 200;
const received: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      received.push(body);
      res.statusCode = nextStatus;
      res.end("ok");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => { r(); }));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/hook`;
});

afterAll(() => {
  server.close();
});

describe("TeamsSender", () => {
  const msg = { to: null, subject: "Sözleşme bitişi", body: "Yaklaşan bitiş", recipientName: "A" };

  it("2xx yanıtında SENT döner ve gövdeyi JSON olarak gönderir", async () => {
    nextStatus = 200;
    received.length = 0;
    const r = await new TeamsSender(base).send(msg);
    expect(r).toEqual({ status: "SENT" });
    expect(JSON.parse(received[0] ?? "{}")).toEqual({ text: "**Sözleşme bitişi**\n\nYaklaşan bitiş" });
  });

  it("5xx yanıtında FAILED döner (hata kodu HTTP_*; URL hata metninde yer almaz)", async () => {
    nextStatus = 500;
    const r = await new TeamsSender(base).send(msg);
    expect(r.status).toBe("FAILED");
    if (r.status === "FAILED") {
      expect(r.errorCode).toBe("HTTP_500");
      expect(r.errorMessage).not.toContain("127.0.0.1");
    }
  });

  it("ulaşılamayan adreste FAILED döner, istisna fırlatmaz", async () => {
    const r = await new TeamsSender("http://127.0.0.1:1/none").send(msg);
    expect(r.status).toBe("FAILED");
  });
});

describe("SmtpSender", () => {
  it("geçersiz alıcıda ağ çağrısı yapmadan FAILED döner", async () => {
    const s = new SmtpSender("smtp://127.0.0.1:1", "ekos@example.com");
    const r = await s.send({ to: "gecersiz", subject: "x", body: "y", recipientName: "A" });
    expect(r).toEqual({ status: "FAILED", errorCode: "NO_RECIPIENT_ADDRESS", errorMessage: "Alıcının geçerli e-posta adresi yok" });
  });

  it("erişilemeyen SMTP sunucusunda FAILED döner ve parola/ayrıntı sızdırmaz", async () => {
    const s = new SmtpSender("smtp://user:gizli-parola@127.0.0.1:1", "ekos@example.com");
    const r = await s.send({ to: "a@example.com", subject: "x", body: "y", recipientName: "A" });
    expect(r.status).toBe("FAILED");
    if (r.status === "FAILED") {
      expect(r.errorMessage).not.toContain("gizli-parola");
      expect(r.errorCode.startsWith("SMTP_")).toBe(true);
    }
  });
});
