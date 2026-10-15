// SMTP e-posta göndericisi (nodemailer). Bağlantı dizesi (SMTP_URL) ortam değişkeninden okunur; DB'de tutulmaz.
import nodemailer from "nodemailer";
import type { DeliveryMessage, DeliveryResult, DeliverySender } from "./types.js";

const TIMEOUT_MS = 15_000;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export class SmtpSender implements DeliverySender {
  private readonly transport: ReturnType<typeof nodemailer.createTransport>;
  constructor(
    url: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport({ url, connectionTimeout: TIMEOUT_MS, greetingTimeout: TIMEOUT_MS, socketTimeout: TIMEOUT_MS });
  }

  async send(msg: DeliveryMessage): Promise<DeliveryResult> {
    if (!msg.to || !EMAIL_RE.test(msg.to)) {
      return { status: "FAILED", errorCode: "NO_RECIPIENT_ADDRESS", errorMessage: "Alıcının geçerli e-posta adresi yok" };
    }
    try {
      await this.transport.sendMail({ from: this.from, to: msg.to, subject: msg.subject, text: msg.body });
      return { status: "SENT" };
    } catch (err) {
      // Sunucu ayrıntısı (kimlik bilgisi içerebilir) kayda alınmaz; yalnızca sınıf adı.
      const code = err instanceof Error && "code" in err && typeof (err as { code?: unknown }).code === "string" ? (err as { code: string }).code : "SMTP_ERROR";
      return { status: "FAILED", errorCode: `SMTP_${code}`.slice(0, 60), errorMessage: "E-posta gönderilemedi" };
    }
  }

  async verify(): Promise<boolean> {
    try {
      await this.transport.verify();
      return true;
    } catch {
      return false;
    }
  }
}
