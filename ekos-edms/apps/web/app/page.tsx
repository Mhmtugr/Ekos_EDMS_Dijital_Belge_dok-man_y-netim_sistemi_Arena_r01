import { redirect } from "next/navigation";

// Kök adres giriş ekranına yönlendirilir (deny-by-default: kullanıcıya iç sayfa gösterilmez).
export default function HomePage(): void {
  redirect("/giris");
}
