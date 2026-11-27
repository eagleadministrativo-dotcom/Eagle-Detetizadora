import type { Metadata, Viewport } from "next";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/600.css";
import "@fontsource/cormorant-garamond/500-italic.css";
import "@fontsource-variable/inter";
import "./styles.css";
import { cookies } from "next/headers";
import { THEME_COOKIE } from "@/server/session";
import { Suspense } from "react";
import { FormGuard } from "@/components/form-guard";

export const metadata: Metadata = {
  title: { default: "Eagle Detetizadora", template: "%s · Eagle Detetizadora" },
  description: "Gestão de detetização: agendamentos, clientes, orçamentos e financeiro.",
  robots: { index: false, follow: false },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
  appleWebApp: { capable: true, title: "Eagle", statusBarStyle: "default" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f4f4f2" }, { media: "(prefers-color-scheme: dark)", color: "#0d0d0d" }] };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookie = (await cookies()).get(THEME_COOKIE)?.value;
  const theme = cookie === "light" || cookie === "dark" ? cookie : undefined;
  return (
    <html lang="pt-BR" data-theme={theme} data-scheme={theme} suppressHydrationWarning>
      <head>
        {/* resolve o tema "automático" antes da primeira pintura (sem piscar); precisa ser síncrono */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme.js" />
      </head>
      <body>
        {children}
        {/* trava o botão enquanto salva, para não gravar duas vezes no clique duplo */}
        <Suspense fallback={null}><FormGuard /></Suspense>
      </body>
    </html>
  );
}
