import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db";
import { openAccessLink } from "@/server/services/invites";

export const dynamic = "force-dynamic";

/** Link do e-mail de primeiro acesso: confirma o e-mail e leva à tela de criar a senha. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ok = /^[A-Za-z0-9_-]{20,80}$/.test(token) ? await openAccessLink(await getDb(), token) : null;
  const base = new URL(req.url);
  if (!ok) return NextResponse.redirect(new URL("/login?erro=" + encodeURIComponent("Este link expirou ou já foi usado. Entre de novo com a senha provisória para receber outro."), base));
  const res = NextResponse.redirect(new URL("/definir-senha", base));
  const secure = process.env.NODE_ENV === "production";
  res.cookies.set("marfim_fluxo", ok, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 3600 });
  res.cookies.set("marfim_conhecido", "1", { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 400 * 86400 });
  return res;
}
