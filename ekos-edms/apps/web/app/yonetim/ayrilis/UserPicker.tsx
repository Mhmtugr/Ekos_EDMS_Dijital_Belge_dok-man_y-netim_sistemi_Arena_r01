"use client";

import { useEffect, useState } from "react";
import { callApi } from "../gov-client";

interface PickedUser {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
}

/** Aktif kullanıcı seçici. Form içine gizli alan olarak `name` ile kimlik yazar. Enter formu göndermez. */
export function UserPicker({ name, placeholder }: { readonly name: string; readonly placeholder: string }): React.JSX.Element {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<PickedUser[]>([]);
  const [sel, setSel] = useState<PickedUser | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const t = setTimeout(() => {
      void callApi("GET", `/api/users/picker?q=${encodeURIComponent(q)}`).then((r) => {
        if (!active) return;
        if (r.ok && Array.isArray(r.data.items)) {
          setItems(r.data.items as PickedUser[]);
          setErr(null);
        } else {
          setErr("Kullanıcı listesi alınamadı.");
        }
      });
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <div style={{ display: "grid", gap: "0.25rem" }}>
      <input
        value={q}
        placeholder={placeholder}
        onChange={(e) => {
          setQ(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
        }}
      />
      <input type="hidden" name={name} value={sel?.id ?? ""} />
      <ul style={{ margin: 0, paddingLeft: "1rem", maxHeight: 160, overflowY: "auto", fontSize: "0.85rem" }}>
        {items.map((u) => (
          <li key={u.id}>
            <button type="button" onClick={() => {
                setSel(u);
              }} style={{ fontWeight: sel?.id === u.id ? 700 : 400 }}>
              {u.displayName} · {u.email}
            </button>
          </li>
        ))}
      </ul>
      {sel && <span style={{ fontSize: "0.85rem" }}>Seçilen: {sel.displayName}</span>}
      {err && <span role="alert">{err}</span>}
    </div>
  );
}
