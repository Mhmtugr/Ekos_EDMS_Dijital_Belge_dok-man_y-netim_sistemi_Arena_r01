"use client";

// Belge eylemleri: yeni sürüm, ilişki ekleme, fiziksel konum ve orijinal doğrulama.
// Her form ayrı istek atar; hata biçimi API'den gelen code/message ile gösterilir.
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

const RELATIONS: readonly [string, string][] = [
  ["PARENT_CHILD", "Ana / alt belge"],
  ["ATTACHMENT", "Ek"],
  ["REVISION", "Revizyon"],
  ["ORDER_INVOICE", "Sipariş / fatura"],
  ["CONTRACT_DOCUMENT", "Sözleşme belgesi"],
  ["AMENDMENT", "Zeyilname"],
];

interface ApiBody {
  readonly code?: string;
  readonly message?: string;
  readonly detail?: string;
  readonly scan?: string;
  readonly versionNumber?: number;
}

async function send(url: string, method: string, body: FormData | Record<string, unknown>): Promise<{ ok: boolean; status: number; data: ApiBody }> {
  const isForm = body instanceof FormData;
  const res = await fetch(url, {
    method,
    headers: isForm ? { Origin: window.location.origin } : { "Content-Type": "application/json" },
    body: isForm ? body : JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = (await res.json().catch(() => ({}))) as ApiBody;
  return { ok: res.ok, status: res.status, data };
}

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function describe(data: ApiBody, status: number): string {
  return `${data.message ?? data.code ?? "Hata"}${data.detail ? ` — ${data.detail}` : ""} (HTTP ${String(status)})`;
}

function Section({ title, children }: { title: string; children: ReactNode }): React.JSX.Element {
  return (
    <section style={{ border: "1px solid #d0d7de", borderRadius: 6, padding: "1rem", marginTop: "1rem" }}>
      <h2 style={{ fontSize: "1rem", margin: "0 0 0.75rem" }}>{title}</h2>
      {children}
    </section>
  );
}

/** rowVersion: belge sürümü (yeni sürüm için). locationRowVersion: fiziksel konum kaydının sürümü (0 = henüz kayıt yok). */
export function DocActions({
  docId,
  rowVersion,
  locationRowVersion,
  canNewVersion,
  canEditLocation,
}: {
  docId: string;
  rowVersion: number;
  locationRowVersion: number;
  canNewVersion: boolean;
  canEditLocation: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<string>): Promise<void> {
    setBusy(true);
    setMsg(null);
    try {
      setMsg(await fn());
      router.refresh();
    } catch {
      setMsg("Bağlantı hatası; işlem tamamlanmadı.");
    } finally {
      setBusy(false);
    }
  }

  async function onVersion(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set("expectedRowVersion", String(rowVersion));
    await run(async () => {
      const r = await send(`/api/documents/${docId}/versions`, "POST", fd);
      if (!r.ok) return `Sürüm eklenemedi: ${describe(r.data, r.status)}`;
      form.reset();
      const scan = r.data.scan === "NOT_CONFIGURED" ? " Tarama yapılandırılmadığı için belge karantinada; hazır değil." : ` Tarama: ${r.data.scan ?? "?"}.`;
      return `Sürüm ${String(r.data.versionNumber ?? "")} eklendi.${scan} Önceki sürüm salt-okunur olarak korundu.`;
    });
  }

  async function onRelation(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await run(async () => {
      const r = await send(`/api/documents/${docId}/relations`, "POST", {
        toId: str(fd, "toId"),
        relationType: str(fd, "relationType"),
      });
      return r.ok ? "İlişki eklendi." : `İlişki eklenemedi: ${describe(r.data, r.status)}`;
    });
  }

  async function onLocation(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const field = (k: string): string => str(fd, k);
    await run(async () => {
      const r = await send(`/api/documents/${docId}/physical-location`, "PUT", {
        expectedRowVersion: locationRowVersion,
        location: { box: field("box"), file: field("file"), shelf: field("shelf") },
      });
      return r.ok ? "Fiziksel konum kaydedildi." : `Konum kaydedilemedi: ${describe(r.data, r.status)}`;
    });
  }

  async function onVerify(): Promise<void> {
    await run(async () => {
      const r = await send(`/api/documents/${docId}/verify-original`, "POST", { expectedRowVersion: locationRowVersion });
      return r.ok ? "Fiziksel orijinal doğrulandı." : `Doğrulanamadı: ${describe(r.data, r.status)}`;
    });
  }

  const input = { padding: "0.4rem", marginRight: "0.5rem", marginBottom: "0.5rem" } as const;

  return (
    <div>
      {msg !== null && (
        <p role="status" style={{ background: "#ddf4ff", border: "1px solid #54aeff", padding: "0.5rem 0.75rem", borderRadius: 6 }}>
          {msg}
        </p>
      )}

      {canNewVersion && (
        <Section title="Yeni sürüm">
          <form onSubmit={(e) => void onVersion(e)}>
            <input name="file" type="file" required disabled={busy} style={input} />
            <input name="reason" required maxLength={500} placeholder="Gerekçe (zorunlu)" disabled={busy} style={{ ...input, width: 320 }} />
            <button type="submit" disabled={busy}>Sürüm yükle</button>
          </form>
          <p style={{ fontSize: "0.8rem", color: "#57606a" }}>Yeni sürüm karantinaya girer; eski sürüm değiştirilmeden saklanır.</p>
        </Section>
      )}

      <Section title="İlişkili belge ekle">
        <form onSubmit={(e) => void onRelation(e)}>
          <input name="toId" required placeholder="Hedef belge kimliği (UUID)" disabled={busy} style={{ ...input, width: 320 }} />
          <select name="relationType" disabled={busy} style={input}>
            {RELATIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <button type="submit" disabled={busy}>Ekle</button>
        </form>
      </Section>

      {canEditLocation && (
        <Section title="Fiziksel arşiv konumu">
          <form onSubmit={(e) => void onLocation(e)}>
            <input name="box" placeholder="Kutu" maxLength={60} disabled={busy} style={input} />
            <input name="file" placeholder="Dosya no" maxLength={60} disabled={busy} style={input} />
            <input name="shelf" placeholder="Raf" maxLength={60} disabled={busy} style={input} />
            <button type="submit" disabled={busy}>Konumu kaydet</button>
          </form>
          <button type="button" onClick={() => void onVerify()} disabled={busy} style={{ marginTop: "0.5rem" }}>
            Fiziksel orijinali doğrula
          </button>
        </Section>
      )}
    </div>
  );
}
