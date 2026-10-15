import type { ReactNode } from "react";

export const metadata = {
  title: "EKOS EDMS",
  description: "EKOS Enterprise Document & Contract Management",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
