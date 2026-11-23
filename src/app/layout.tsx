import type { Metadata, Viewport } from "next";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/600.css";
import "@fontsource/cormorant-garamond/500-italic.css";
import "@fontsource-variable/inter";
import "./styles.css";
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
  const cookie = (await cookies()).get("marfim_theme")?.value;
  const theme = cookie === "light" || cookie === "dark" ? cookie : undefined;
  return (
    <html lang="pt-BR" data-theme={theme} data-scheme={theme} suppressHydrationWarning>
      <head>
        {/* resolve o tema "automático" antes da primeira pintura (sem piscar); precisa ser síncrono */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme.js" />
      </head>
      <body>{children}</body>
    </html>
  );
}
