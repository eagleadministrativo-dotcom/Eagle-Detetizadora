import type { Metadata, Viewport } from "next";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/600.css";
import "@fontsource/cormorant-garamond/500-italic.css";
import "@fontsource-variable/inter";
import "./tokens.css";
import "./globals.css";
import "./v4.css";
import "./v5.css";
import "./v6.css";
import "./v7.css";
import { cookies } from "next/headers";

export const metadata: Metadata = {
  title: { default: "MARFIM Studio OS", template: "%s · MARFIM Studio OS" },
  description: "Gestão da barbearia: agenda, atendimentos, caixa e financeiro.",
  robots: { index: false, follow: false },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
  appleWebApp: { capable: true, title: "MARFIM", statusBarStyle: "default" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: [{ media: "(prefers-color-scheme: light)", color: "#ebe4dc" }, { media: "(prefers-color-scheme: dark)", color: "#1c1c1e" }] };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get("marfim_theme")?.value;
  return (
    <html lang="pt-BR" data-theme={theme === "light" || theme === "dark" ? theme : undefined} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
