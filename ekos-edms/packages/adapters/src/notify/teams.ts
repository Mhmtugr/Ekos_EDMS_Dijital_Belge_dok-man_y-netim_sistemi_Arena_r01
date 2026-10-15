// Microsoft Teams gelen web kancası (incoming webhook) göndericisi. URL ortam değişkeninden okunur; loglarda yazılmaz.
import type { DeliveryMessage, DeliveryResult, DeliverySender } from "./types.js";

const TIMEOUT_MS = 15_000;

export class TeamsSender implements DeliverySender {
  constructor(private readonly webhookUrl: string) {}

  async send(msg: DeliveryMessage): Promise<DeliveryResult> {
    try {
      const res = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `**${msg.subject}**\n\n${msg.body}` }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return { status: "SENT" };
      return { status: "FAILED", errorCode: `HTTP_${String(res.status)}`, errorMessage: `Teams kancası ${String(res.status)} yanıtı verdi` };
    } catch (err) {
      const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      return { status: "FAILED", errorCode: timeout ? "TIMEOUT" : "NETWORK", errorMessage: "Teams kancasına ulaşılamadı" };
    }
  }
}
