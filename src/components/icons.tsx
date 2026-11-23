import type { ReactElement } from "react";

// Conjunto próprio de ícones de traço (24×24, stroke 1.6), sem dependência externa.
const P: Record<string, ReactElement> = {
  home: <path d="M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10" />,
  calendar: <path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" />,
  scissors: <path d="M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8.2 7.8 20 18M8.2 16.2 20 6" />,
  users: <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 10a7 7 0 0 1 14 0M17 4a4 4 0 0 1 0 7M19 21a7 7 0 0 0-3-5.7" />,
  wallet: <path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l12-3v3M16 14h2" />,
  chart: <path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3" />,
  gear: <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-2a7.5 7.5 0 0 0 0-2l2-1.5-2-3.4-2.3 1a7.5 7.5 0 0 0-1.7-1L15 3h-4l-.4 3.1a7.5 7.5 0 0 0-1.7 1l-2.3-1-2 3.4 2 1.5a7.5 7.5 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7.5 7.5 0 0 0 1.7 1L11 21h4l.4-3.1a7.5 7.5 0 0 0 1.7-1l2.3 1 2-3.4z" />,
  bell: <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4" />,
  collapse: <path d="m15 6-6 6 6 6" />,
  expand: <path d="m9 6 6 6-6 6" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
  arrow: <path d="M7 17 17 7M9 7h8v8" />,
  receipt: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" />,
  search: <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 4 4" />,
  sun: <path d="M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />,
  auto: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 3v18M12 8h7M12 12h9M12 16h7" />,
  check: <path d="M4 6h10M4 12h7M4 18h7M14 15l3 3 5-6" />,
  repeat: <path d="M4 11a8 8 0 0 1 14-4l2 2M20 4v5h-5M20 13a8 8 0 0 1-14 4l-2-2M4 20v-5h5" />,
  box: <path d="m12 3 8 4v10l-8 4-8-4V7zM4 7l8 4 8-4M12 11v10" />,
  coins: <path d="M9 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM15.5 8.2A6 6 0 1 1 9 17" />,
  trophy: <path d="M7 4h10v5a5 5 0 0 1-10 0zM7 6H4c0 3 1 5 3.5 5M17 6h3c0 3-1 5-3.5 5M12 14v4M8 21h8M10 18h4" />,
  team: <path d="M12 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM5 21a7 7 0 0 1 14 0M4 13a2.5 2.5 0 1 0 0-5M20 13a2.5 2.5 0 1 1 0-5" />,
  shield: <path d="M12 3 4 6v6c0 4.5 3.2 7.8 8 9 4.8-1.2 8-4.5 8-9V6z" />,
};
export type IconName = keyof typeof P;

export function Icon({ name, className = "ic" }: { name: IconName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {P[name]}
    </svg>
  );
}

/** Ícone sugerido por rota (menu lateral e navegação móvel). */
export function iconFor(href: string): IconName {
  if (href === "/") return "home";
  if (href.startsWith("/agenda")) return "calendar";
  if (href.startsWith("/atendimentos")) return "scissors";
  if (href.startsWith("/clientes")) return "users";
  if (href.startsWith("/tarefas")) return "check";
  if (href.startsWith("/retornos")) return "repeat";
  if (href.startsWith("/produtos")) return "box";
  if (href.startsWith("/comissoes") || href.startsWith("/meu-financeiro")) return "coins";
  if (href.startsWith("/conquistas")) return "trophy";
  if (href.startsWith("/equipe")) return "team";
  if (href.startsWith("/notificacoes")) return "bell";
  if (href.startsWith("/financeiro")) return "wallet";
  if (href.startsWith("/relatorios")) return "chart";
  if (href.startsWith("/admin/auditoria") || href.startsWith("/admin/usuarios")) return "shield";
  if (href.startsWith("/admin")) return "gear";
  return "receipt";
}
