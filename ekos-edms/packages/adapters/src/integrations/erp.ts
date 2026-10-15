// ERP / satın alma bağlantı arayüzü (Faz 6). Gerçek bağlayıcı yoktur; yalnız sözleşme tanımlanır ve NOT_CONFIGURED döner.
export const ERP_KEY = "erp";

export interface ErpPurchaseOrder {
  readonly externalId: string;
  readonly supplierExternalId: string;
  readonly amount: string;
  readonly currency: string;
  readonly issuedAt: string;
}

export interface ErpConnector {
  readonly key: string;
  listPurchaseOrders(since: Date): Promise<{ status: "OK"; items: ErpPurchaseOrder[] } | { status: "NOT_CONFIGURED" } | { status: "FAILED"; errorCode: string }>;
}

/** Varsayılan bağlayıcı: kimlik bilgisi/uygulama yok → her zaman NOT_CONFIGURED. */
export class NotConfiguredErpConnector implements ErpConnector {
  readonly key = ERP_KEY;
  listPurchaseOrders(): Promise<{ status: "NOT_CONFIGURED" }> {
    return Promise.resolve({ status: "NOT_CONFIGURED" });
  }
}
