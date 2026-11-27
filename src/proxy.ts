import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, SESSION_COOKIE_OPTIONS } from "@/server/session-cookie";

/** Cada visita renova o prazo do cookie de login: quem usa o app não precisa entrar de novo. */
export function proxy(req: NextRequest) {
  const res = NextResponse.next();
  const token = req.cookies.get(COOKIE)?.value;
  if (token) res.cookies.set(COOKIE, token, SESSION_COOKIE_OPTIONS);
  return res;
}

export const config = { matcher: ["/((?!_next/|api/|icons/|brand/|sw.js|theme.js|manifest.webmanifest|wallpaper.jpg|favicon.ico).*)"] };
