// Microsoft Graph: uygulama (client credentials) belirteci, e-posta gönderimi ve SharePoint içe aktarımı.
// Kimlik bilgisi yoksa her çağrı NOT_CONFIGURED sonucu üretir; sahte "gönderildi" yazılmaz.
import { IntegrationError, readEnv, type Env } from "./types.js";

export const GRAPH_MAIL_KEY = "mail-graph";
export const GRAPH_MAIL_REQUIRED_ENV = ["ENTRA_TENANT_ID", "ENTRA_CLIENT_ID", "ENTRA_CLIENT_SECRET", "GRAPH_MAIL_SENDER"] as const;
export const SHAREPOINT_KEY = "sharepoint";
export const SHAREPOINT_REQUIRED_ENV = ["ENTRA_TENANT_ID", "ENTRA_CLIENT_ID", "ENTRA_CLIENT_SECRET", "SHAREPOINT_SITE_ID", "SHAREPOINT_DRIVE_ID"] as const;

export interface GraphAppConfig {
  readonly tenantId: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

export function readGraphAppConfig(env: Env): GraphAppConfig | null {
  const tenantId = readEnv(env, "ENTRA_TENANT_ID");
  const clientId = readEnv(env, "ENTRA_CLIENT_ID");
  const clientSecret = readEnv(env, "ENTRA_CLIENT_SECRET");
  if (!tenantId || !clientId || !clientSecret) return null;
  return { tenantId, clientId, clientSecret };
}

/** Uygulama belirteci; süresi dolmadan önce yenilenir. Önbellek süreç içidir. */
export class GraphTokenProvider {
  private cache: { token: string; expiresAt: number } | null = null;
  constructor(
    private readonly cfg: GraphAppConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async token(now: number = Date.now()): Promise<string> {
    if (this.cache && this.cache.expiresAt - 60_000 > now) return this.cache.token;
    let res: Response;
    try {
      res = await this.fetchFn(`https://login.microsoftonline.com/${encodeURIComponent(this.cfg.tenantId)}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.cfg.clientId,
          client_secret: this.cfg.clientSecret,
          grant_type: "client_credentials",
          scope: "https://graph.microsoft.com/.default",
        }).toString(),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new IntegrationError("GRAPH_UNREACHABLE", true);
    }
    if (!res.ok) throw new IntegrationError(`GRAPH_TOKEN_HTTP_${String(res.status)}`, res.status >= 500);
    const body = (await res.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
    if (!body || typeof body.access_token !== "string") throw new IntegrationError("GRAPH_TOKEN_MISSING", false);
    const ttl = typeof body.expires_in === "number" ? body.expires_in : 3600;
    this.cache = { token: body.access_token, expiresAt: now + ttl * 1000 };
    return body.access_token;
  }
}

export interface MailMessage {
  readonly to: string | null;
  readonly subject: string;
  readonly body: string;
  readonly recipientName: string;
}

export type MailResult =
  | { readonly status: "SENT" }
  | { readonly status: "NOT_CONFIGURED" }
  | { readonly status: "FAILED"; readonly errorCode: string; readonly errorMessage: string };

/** Bildirim portu (DeliverySender) ile uyumlu Graph e-posta göndericisi. */
export class GraphMailSender {
  constructor(
    private readonly tokens: GraphTokenProvider,
    private readonly sender: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(msg: MailMessage): Promise<MailResult> {
    if (!msg.to) return { status: "FAILED", errorCode: "NO_RECIPIENT_ADDRESS", errorMessage: "Alıcı e-posta adresi yok" };
    let token: string;
    try {
      token = await this.tokens.token();
    } catch (e) {
      const code = e instanceof IntegrationError ? e.code : "GRAPH_TOKEN_FAILED";
      return { status: "FAILED", errorCode: code, errorMessage: "Graph kimlik doğrulaması başarısız" };
    }
    let res: Response;
    try {
      res = await this.fetchFn(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(this.sender)}/sendMail`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            subject: msg.subject.slice(0, 200),
            body: { contentType: "Text", content: msg.body.slice(0, 10_000) },
            toRecipients: [{ emailAddress: { address: msg.to, name: msg.recipientName.slice(0, 200) } }],
          },
          saveToSentItems: false,
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      return { status: "FAILED", errorCode: "GRAPH_UNREACHABLE", errorMessage: "Graph'a ulaşılamadı" };
    }
    if (res.status === 202 || res.ok) return { status: "SENT" };
    return { status: "FAILED", errorCode: `GRAPH_HTTP_${String(res.status)}`, errorMessage: `Graph yanıtı ${String(res.status)}` };
  }
}

export interface SharePointItem {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly isFolder: boolean;
  readonly eTag: string | null;
}

/** Klasördeki dosyaları listeler (yalnız dosyalar; klasörler atlanır). Sayfalama @odata.nextLink ile. */
export async function listSharePointFiles(
  tokens: GraphTokenProvider,
  p: { siteId: string; driveId: string; folderPath: string },
  fetchFn: typeof fetch = fetch,
): Promise<SharePointItem[]> {
  const token = await tokens.token();
  const safePath = p.folderPath.split("/").filter((s) => s.length > 0).map(encodeURIComponent).join("/");
  let url: string | null = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(p.siteId)}/drives/${encodeURIComponent(p.driveId)}/root:/${safePath}:/children?$select=id,name,size,folder,eTag`;
  const out: SharePointItem[] = [];
  let pages = 0;
  while (url && pages < 20) {
    pages += 1;
    const res: Response = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new IntegrationError(`GRAPH_LIST_HTTP_${String(res.status)}`, res.status >= 500);
    const body = (await res.json().catch(() => null)) as { value?: unknown; "@odata.nextLink"?: unknown } | null;
    if (!body || !Array.isArray(body.value)) throw new IntegrationError("GRAPH_LIST_INVALID", false);
    for (const raw of body.value as Record<string, unknown>[]) {
      if (typeof raw.id !== "string" || typeof raw.name !== "string") continue;
      out.push({
        id: raw.id,
        name: raw.name,
        size: typeof raw.size === "number" ? raw.size : 0,
        isFolder: raw.folder !== undefined,
        eTag: typeof raw.eTag === "string" ? raw.eTag : null,
      });
    }
    url = typeof body["@odata.nextLink"] === "string" ? body["@odata.nextLink"] : null;
  }
  return out.filter((i) => !i.isFolder);
}

export async function downloadSharePointFile(
  tokens: GraphTokenProvider,
  p: { siteId: string; driveId: string; itemId: string; maxBytes: number },
  fetchFn: typeof fetch = fetch,
): Promise<Uint8Array> {
  const token = await tokens.token();
  const res = await fetchFn(`https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(p.siteId)}/drives/${encodeURIComponent(p.driveId)}/items/${encodeURIComponent(p.itemId)}/content`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new IntegrationError(`GRAPH_DOWNLOAD_HTTP_${String(res.status)}`, res.status >= 500);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > p.maxBytes) throw new IntegrationError("FILE_TOO_LARGE", false);
  return buf;
}
