"use client";

import { useRouter } from "next/navigation";

export function LogoutButton(): React.JSX.Element {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        void fetch("/api/auth/logout", { method: "POST" }).finally(() => {
          router.replace("/giris");
        });
      }}
    >
      Çıkış
    </button>
  );
}
