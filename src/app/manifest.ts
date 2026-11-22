import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MARFIM Studio OS",
    short_name: "MARFIM",
    description: "Gestão da barbearia: agenda, atendimentos, caixa e financeiro.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f6f1e7",
    theme_color: "#591d27",
    lang: "pt-BR",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
