// Bildirim teslim portu (yapısal tip). @ekos/db'deki DeliverySender ile birebir aynı şekle sahiptir;
// adaptör paketi @ekos/db'ye bağımlı olmadığı için burada yeniden tanımlanır (döngüsel bağımlılık yok).
export interface DeliveryMessage {
  readonly to: string | null;
  readonly subject: string;
  readonly body: string;
  readonly recipientName: string;
}
export type DeliveryResult =
  | { readonly status: "SENT" }
  | { readonly status: "NOT_CONFIGURED" }
  | { readonly status: "FAILED"; readonly errorCode: string; readonly errorMessage: string };
export interface DeliverySender {
  send(msg: DeliveryMessage): Promise<DeliveryResult>;
}
export type DeliverySenders = Partial<Record<"EMAIL" | "TEAMS", DeliverySender | null>>;
