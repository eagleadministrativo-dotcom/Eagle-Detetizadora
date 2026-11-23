// Varredura de segredos nos arquivos versionados. Falha (código 1) se encontrar algo parecido com credencial real.
// Roda no CI a cada envio. Senhas de DEMONSTRAÇÃO e de testes (bases fictícias) ficam na lista de permitidos.
import { execSync } from "node:child_process";
import fs from "node:fs";

const RULES = [
  ["URL de banco com senha", /postgres(?:ql)?:\/\/[^:\s/]+:([^@\s]{6,})@/g],
  ["chave JWT (Supabase/serviço)", /eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/g],
  ["chave privada", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ["token do GitHub", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g],
  ["token da Vercel/Stripe", /\b(?:sk_live_[A-Za-z0-9]{16,}|vercel_[A-Za-z0-9]{20,})\b/g],
  ["chave Supabase (service role/secret)", /\bsb_secret_[A-Za-z0-9_-]{20,}\b/g],
  ["segredo atribuído no código", /\b(?:CRON_SECRET|VAPID_PRIVATE_KEY|DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY|WHATSAPP_TOKEN)\s*[=:]\s*["'`][^"'`\s]{12,}["'`]/g],
];
const ALLOW = [/Demo@Marfim2026/, /SenhaForte123/, /:SENHA@/, /postgres.xxxx/, /postgres:\/\/postgres:postgres@localhost/, /user:senha@host/];
const SKIP = /(^|\/)(package-lock\.json|.*\.(png|jpg|jpeg|ico|webp|woff2?|ttf|pdf|zip))$/;

const files = execSync("git ls-files -co --exclude-standard", { encoding: "utf8" }).split("\n").filter((f) => f && !SKIP.test(f) && fs.existsSync(f));
const found = [];
for (const f of files) {
  let text;
  try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
  if (text.includes("\u0000")) continue;
  for (const [label, re] of RULES) {
    for (const m of text.matchAll(re)) {
      const line = text.slice(0, m.index).split("\n").length;
      const ctx = text.split("\n")[line - 1] ?? "";
      if (ALLOW.some((a) => a.test(ctx))) continue;
      found.push(`${f}:${line} — ${label}`);
    }
  }
}
if (found.length) {
  console.error("Possíveis segredos versionados (o valor não é exibido):\n" + found.map((x) => "  " + x).join("\n"));
  process.exit(1);
}
console.log(`Varredura de segredos: ${files.length} arquivos, nada encontrado.`);
