import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, SESSION_COOKIE_OPTIONS } from "@/server/session-cookie";

/**
 * Telas do sistema de origem (barbearia) que não fazem parte do fluxo da Eagle: atendimento, caixa, comissões,
 * venda de produtos e o financeiro por cobranças. O serviço da Eagle anda pela OS; quem abrir um link antigo
 * vai para a tela equivalente.
 */
const LEGACY: [RegExp, string][] = [
  [/^\/atendimentos(\/|$)/, "/os"],
  [/^\/(comissoes|produtos|compras|conquistas|meu-financeiro)(\/|$)/, "/"],
  [/^\/financeiro\/(caixa|receber|pagar|conciliacao|fluxo|dre|fechamento|metas)(\/|$)/, "/financeiro"],
  [/^\/equipe(\/|$)/, "/"],
];

/** Cada visita renova o prazo do cookie de login: quem usa o app não precisa entrar de novo. */
export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const legacy = LEGACY.find(([re]) => re.test(path));
  if (legacy) return NextResponse.redirect(new URL(legacy[1], req.url));
  const res = NextResponse.next();
  const token = req.cookies.get(COOKIE)?.value;
  if (token) res.cookies.set(COOKIE, token, SESSION_COOKIE_OPTIONS);
  return res;
}

export const config = { matcher: ["/((?!_next/|api/|icons/|brand/|sw.js|theme.js|manifest.webmanifest|wallpaper.jpg|favicon.ico).*)"] };
