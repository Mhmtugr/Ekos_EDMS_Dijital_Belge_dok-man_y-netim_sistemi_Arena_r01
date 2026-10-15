"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi, field, messageOf } from "../gov-client";

interface Props {
  readonly mode: "create" | "verify";
  readonly profiles?: { id: string; code: string; rowVersion: number }[];
}

const START = ["DOCUMENT_CREATED", "CONTRACT_END", "FISCAL_YEAR_END", "MANUAL_EVENT"];
const UNITS = ["CALENDAR_DAYS", "CALENDAR_MONTHS", "CALENDAR_YEARS"];
const METHODS = ["DIGITAL_DELETE", "PHYSICAL_DESTRUCTION_RECORD"];

export function ProfileForms({ mode, profiles = [] }: Props): React.JSX.Element {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);

  async function onCreate(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const t = (k: string): string | null => {
      const v = field(fd, k).trim();
      return v === "" ? null : v;
    };
    const dv = t("durationValue");
    const approvers = (t("disposalApproverIds") ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
    const r = await callApi("POST", "/api/governance/retention-profiles", {
      code: t("code") ?? "",
      effectiveFrom: t("effectiveFrom") ?? "",
      basisNote: t("basisNote"),
      startEvent: t("startEvent"),
      durationValue: dv === null ? null : Number(dv),
      durationUnit: t("durationUnit"),
      disposalMethod: t("disposalMethod"),
      responsibleId: t("responsibleId"),
      disposalApproverIds: approvers,
      requiresLegalReview: fd.get("requiresLegalReview") === "on",
    });
    setMsg(messageOf(r, "Profil oluşturuldu (hukuken doğrulanmadı)."));
    if (r.ok) {
      form.reset();
      router.refresh();
    }
  }

  async function onVerify(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const sel = e.currentTarget.elements.namedItem("profileId") as HTMLSelectElement | null;
    const id = sel?.value ?? "";
    const rv = Number(sel?.selectedOptions[0]?.dataset.rv ?? 0);
    if (!id || rv < 1) {
      setMsg("Profil seçin.");
      return;
    }
    const r = await callApi("POST", `/api/governance/retention-profiles/${id}/verify`, { expectedRowVersion: rv });
    setMsg(messageOf(r, "Profil hukuken doğrulandı."));
    if (r.ok) router.refresh();
  }

  if (mode === "verify") {
    return (
      <form onSubmit={(e) => void onVerify(e)} style={{ display: "grid", gap: "0.5rem", maxWidth: 480 }}>
        <select name="profileId" required defaultValue="">
          <option value="" disabled>
            Profil seçin
          </option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id} data-rv={p.rowVersion}>
              {p.code}
            </option>
          ))}
        </select>
        <button type="submit">Hukuken doğrula</button>
        {msg && <p role="status">{msg}</p>}
      </form>
    );
  }

  return (
    <form onSubmit={(e) => void onCreate(e)} style={{ display: "grid", gap: "0.5rem", maxWidth: 560 }}>
      <input name="code" required maxLength={59} placeholder="Profil kodu (büyük harf, ör. SOZ-KAYIT)" />
      <input name="effectiveFrom" type="date" required />
      <textarea name="basisNote" maxLength={2000} placeholder="Dayanak notu (hukuki doğrulama için zorunlu)" />
      <select name="startEvent" defaultValue="">
        <option value="">Başlangıç olayı (politika bekleniyor)</option>
        {START.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <input name="durationValue" type="number" min={0} placeholder="Süre (kurum politikasından; boş bırakılabilir)" />
      <select name="durationUnit" defaultValue="">
        <option value="">Süre birimi</option>
        {UNITS.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <select name="disposalMethod" defaultValue="">
        <option value="">İmha yöntemi</option>
        {METHODS.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <input name="disposalApproverIds" placeholder="İmha onaycı kullanıcı kimlikleri (virgülle, en az 2)" />
      <input name="responsibleId" placeholder="Sorumlu kullanıcı kimliği (isteğe bağlı)" />
      <label>
        <input name="requiresLegalReview" type="checkbox" /> KVKK / sektörel hukuk incelemesi gerekir
      </label>
      <button type="submit">Oluştur</button>
      {msg && <p role="status">{msg}</p>}
    </form>
  );
}
