import type { Metadata, Viewport } from "next";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/inter";
import "./tokens.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "MARFIM Studio OS", template: "%s · MARFIM Studio OS" },
  description: "Gestão da barbearia: agenda, atendimentos, caixa e financeiro.",
  robots: { index: false, follow: false },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
  appleWebApp: { capable: true, title: "MARFIM", statusBarStyle: "default" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#591d27" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
