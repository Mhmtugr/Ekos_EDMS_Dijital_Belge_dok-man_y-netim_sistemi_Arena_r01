"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi, field, messageOf } from "../gov-client";
import { UserPicker } from "./UserPicker";

export function OffboardingOpenForm(): React.JSX.Element {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  async function onSubmit(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const userId = field(fd, "userId").trim();
    if (!userId) {
      setMsg("Ayrılan kullanıcıyı seçin.");
      return;
    }
    const r = await callApi("POST", "/api/offboarding", {
      userId,
      reason: field(fd, "reason").trim(),
      blockOnUnresolved: fd.get("blockOnUnresolved") === "on",
    });
    const id = typeof r.data.id === "string" ? r.data.id : null;
    setMsg(messageOf(r, "Vaka açıldı. Kimliği yukarıdaki alanla açabilirsiniz."));
    if (r.ok && id) router.push(`/yonetim/ayrilis?case=${id}`);
  }
  return (
    <form onSubmit={(e) => void onSubmit(e)} style={{ display: "grid", gap: "0.4rem", maxWidth: 560 }}>
      <UserPicker name="userId" placeholder="Ayrılan kullanıcıyı ad veya e-posta ile arayın" />
      <textarea name="reason" required maxLength={2000} placeholder="Gerekçe (zorunlu)" />
      <label>
        <input name="blockOnUnresolved" type="checkbox" defaultChecked /> Açık kalem varken vaka kapatmayı engelle
      </label>
      <button type="submit">Vaka aç</button>
      {msg && <p role="status">{msg}</p>}
    </form>
  );
}

export function OffboardingItemActions({ caseId, itemId, rowVersion }: { caseId: string; itemId: string; rowVersion: number }): React.JSX.Element {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  async function act(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const action = field(fd, "action");
    const body =
      action === "transfer"
        ? { action, toUserId: field(fd, "toUserId").trim(), expectedRowVersion: rowVersion }
        : { action, note: field(fd, "note").trim(), expectedRowVersion: rowVersion };
    const r = await callApi("POST", `/api/offboarding/${caseId}/items/${itemId}`, body);
    setMsg(messageOf(r, "Kalem güncellendi."));
    if (r.ok || r.status === 409) router.refresh();
  }
  return (
    <form onSubmit={(e) => void act(e)} style={{ display: "grid", gap: "0.3rem", minWidth: 240 }}>
      <select name="action" defaultValue="transfer">
        <option value="transfer">Devret</option>
        <option value="waive">Feragat et (gerekçeli)</option>
      </select>
      <UserPicker name="toUserId" placeholder="Devralan kişiyi arayın (devirde)" />
      <input name="note" maxLength={1000} placeholder="Gerekçe / not (feragatte zorunlu)" />
      <button type="submit">Uygula</button>
      {msg && <span role="status">{msg}</span>}
    </form>
  );
}

export function OffboardingCompleteButton({ caseId, rowVersion }: { caseId: string; rowVersion: number }): React.JSX.Element {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  async function complete(): Promise<void> {
    const r = await callApi("POST", `/api/offboarding/${caseId}/complete`, { expectedRowVersion: rowVersion });
    setMsg(messageOf(r, "Vaka tamamlandı."));
    if (r.ok || r.status === 409) router.refresh();
  }
  return (
    <div>
      <button type="button" onClick={() => void complete()}>
        Vakayı tamamla
      </button>
      {msg && <p role="status">{msg}</p>}
    </div>
  );
}

export function OffboardingCancelForm({ caseId, rowVersion }: { caseId: string; rowVersion: number }): React.JSX.Element {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  async function onSubmit(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const form = e.currentTarget;
    const reason = field(new FormData(form), "reason").trim();
    const r = await callApi("POST", `/api/offboarding/${caseId}/cancel`, { reason, expectedRowVersion: rowVersion });
    setMsg(messageOf(r, "Ayrılış dosyası iptal edildi; hesap yeniden aktif."));
    if (r.ok) router.refresh();
    else if (r.status === 409) router.refresh();
  }
  return (
    <form onSubmit={(e) => void onSubmit(e)} style={{ display: "grid", gap: "0.3rem", maxWidth: 520 }}>
      <textarea name="reason" required maxLength={2000} placeholder="İptal gerekçesi (zorunlu; ör. çalışan kurumda kalıyor)" />
      <button type="submit">Dosyayı iptal et</button>
      {msg && <p role="status">{msg}</p>}
    </form>
  );
}
