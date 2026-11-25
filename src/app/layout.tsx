import type { Metadata, Viewport } from "next";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/600.css";
import "@fontsource/cormorant-garamond/500-italic.css";
import "@fontsource-variable/inter";
import "./styles.css";
import { cookies } from "next/headers";

export const metadata: Metadata = {
  title: { default: "Eagle Detetizadora", template: "%s · Eagle Detetizadora" },
  description: "Gestão de detetização: agendamentos, clientes, orçamentos e financeiro.",
  robots: { index: false, follow: false },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
  appleWebApp: { capable: true, title: "Eagle", statusBarStyle: "default" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: [{ media: "(prefers-color-scheme: light)", color: "#ebe4dc" }, { media: "(prefers-color-scheme: dark)", color: "#1c1c1e" }] };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookie = (await cookies()).get("eagle_theme")?.value;
  const theme = cookie === "light" || cookie === "dark" ? cookie : undefined;
  return (
    <html lang="pt-BR" data-theme={theme} data-scheme={theme} suppressHydrationWarning>
      <head>
        {/* resolve o tema "automático" antes da primeira pintura (sem piscar); precisa ser síncrono */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme.js" />
        <style>{`
          html {
            background: url(/wallpaper.svg) no-repeat center center fixed;
            background-size: cover;
            background-attachment: fixed;
          }
          body {
            background: transparent;
          }
          .shell {
            background: rgba(255, 255, 255, 0.92) !important;
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
          }
          :root[data-scheme="dark"] .shell {
            background: rgba(28, 28, 30, 0.88) !important;
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
          }
          .card {
            background: rgba(255, 255, 255, 0.85) !important;
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1) !important;
          }
          :root[data-scheme="dark"] .card {
            background: rgba(28, 28, 30, 0.85) !important;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3) !important;
          }
          .kpi, .btn, input, select, textarea {
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08) !important;
            transition: box-shadow 200ms ease;
          }
          .kpi:hover, .btn:hover, input:hover, select:hover, textarea:hover {
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15) !important;
          }
          .side {
            background: rgba(255, 255, 255, 0.90) !important;
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
          }
          :root[data-scheme="dark"] .side {
            background: rgba(14, 15, 13, 0.90) !important;
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
          }
          .alert {
            background: rgba(255, 255, 255, 0.90) !important;
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
          }
          .badge {
            background: rgba(255, 255, 255, 0.85) !important;
            backdrop-filter: blur(6px);
            -webkit-backdrop-filter: blur(6px);
          }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
