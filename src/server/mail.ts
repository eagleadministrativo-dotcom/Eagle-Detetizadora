import fs from "node:fs";
import path from "node:path";
import { DomainError } from "./errors";

/**
 * Envio de e-mail.
 * - SMTP_URL (ex.: smtps://usuario:senha-de-app@smtp.gmail.com:465) + MAIL_FROM: envia de verdade.
 * - MAIL_OUTBOX_DIR: grava cada mensagem como arquivo .txt (desenvolvimento e testes de ponta a ponta).
 * - Nenhum dos dois: em desenvolvimento escreve no console; em produção recusa com uma mensagem clara.
 */
export interface Mail { to: string; subject: string; text: string; html?: string }

export const mailConfigured = () => !!process.env.SMTP_URL || !!process.env.MAIL_OUTBOX_DIR || process.env.NODE_ENV !== "production";

export async function sendMail(m: Mail): Promise<void> {
  if (process.env.SMTP_URL) {
    const nodemailer = await import("nodemailer");
    const t = nodemailer.createTransport(process.env.SMTP_URL);
    await t.sendMail({ from: process.env.MAIL_FROM || "Eagle Detetizadora <no-reply@eagle.local>", to: m.to, subject: m.subject, text: m.text, html: m.html });
    return;
  }
  const dir = process.env.MAIL_OUTBOX_DIR;
  if (dir) {
    fs.mkdirSync(dir, { recursive: true });
    const safe = m.to.toLowerCase().replace(/[^a-z0-9@._-]/g, "_");
    fs.writeFileSync(path.join(dir, `${Date.now()}-${safe}.txt`), `Para: ${m.to}\nAssunto: ${m.subject}\n\n${m.text}\n`);
    return;
  }
  if (process.env.NODE_ENV !== "production") {
    console.info(`[e-mail de desenvolvimento] para ${m.to}: ${m.subject}\n${m.text}`);
    return;
  }
  throw new DomainError("mail_off", "O envio de e-mails ainda não foi configurado. Avise o administrador.");
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Layout simples, legível em qualquer cliente de e-mail, nas cores da marca. */
export function mailHtml(title: string, paragraphs: string[], code?: string, button?: { href: string; label: string }) {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f2;font-family:Inter,Arial,sans-serif;color:#111111">
<div style="max-width:480px;margin:0 auto;padding:32px 20px">
<p style="font-family:Arial,sans-serif;font-weight:800;font-size:20px;letter-spacing:.08em;margin:0 0 24px"><span style="display:inline-block;background:#111111;color:#f5c400;border-radius:8px;padding:2px 9px;margin-right:8px">E</span>EAGLE <span style="font-size:12px;font-weight:400;color:#8a6d00">Detetizadora</span></p>
<div style="background:#ffffff;border-radius:14px;padding:24px;border-top:4px solid #f5c400">
<h1 style="font-family:Georgia,serif;font-weight:500;font-size:22px;margin:0 0 12px">${esc(title)}</h1>
${paragraphs.map((p) => `<p style="margin:0 0 12px;line-height:1.5">${esc(p)}</p>`).join("")}
${code ? `<p style="font-size:34px;letter-spacing:.3em;font-weight:700;margin:20px 0;color:#111111">${esc(code)}</p>` : ""}
${button ? `<p style="margin:20px 0"><a href="${esc(button.href)}" style="display:inline-block;background:#f5c400;color:#111111;padding:14px 22px;border-radius:999px;text-decoration:none;font-weight:700">${esc(button.label)}</a></p><p style="font-size:12px;color:#595959;word-break:break-all">Se o botão não abrir, copie este endereço: ${esc(button.href)}</p>` : ""}
</div>
<p style="font-size:12px;color:#595959;margin-top:16px">Se você não pediu isto, ignore este e-mail. Ninguém da Eagle pede este código por telefone ou mensagem.</p>
</div></body></html>`;
}

/** Endereço público do app (para links em e-mails). */
export const appUrl = () =>
  process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");
