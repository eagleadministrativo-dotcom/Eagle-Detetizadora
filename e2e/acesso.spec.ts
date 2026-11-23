import fs from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";

/**
 * Primeiro acesso, cadastro por convite e bloqueio após senhas erradas.
 * Os e-mails ficam em .data/e2e-mail (ver e2e/serve.mjs).
 */
const MAIL = ".data/e2e-mail";
const OWNER = { email: "dono@demo.marfim.local", password: "Demo@Marfim2026" };

function lastCode(email: string): string {
  const files = fs.existsSync(MAIL) ? fs.readdirSync(MAIL).filter((f) => f.endsWith(`-${email}.txt`)).sort() : [];
  for (const f of files.reverse()) {
    const m = /Assunto: (\d{6})/.exec(fs.readFileSync(path.join(MAIL, f), "utf8"));
    if (m) return m[1];
  }
  throw new Error(`nenhum código para ${email}`);
}

async function layoutOk(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const p = await page.evaluate(() => ({ over: document.documentElement.scrollWidth > window.innerWidth + 1, h1: document.querySelectorAll("h1").length }));
  expect(p, page.url()).toEqual({ over: false, h1: 1 });
}

test("primeiro acesso mostra boas-vindas e as telas de acesso cabem na tela", async ({ page }) => {
  await page.goto("/login");
  await expect(page).toHaveURL(/\/bem-vindo$/);
  await layoutOk(page);
  await expect(page.getByRole("link", { name: "Cadastrar" })).toBeVisible();
  await page.getByRole("link", { name: "Cadastrar" }).click();
  await expect(page.getByRole("link", { name: /Dono de barbearia/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Barbeiro colaborador/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Administrador/ })).toBeVisible();
  await layoutOk(page);
  for (const p of ["/cadastro/barbeiro", "/esqueci"]) {
    await page.goto(p);
    await layoutOk(page);
  }
});

test("3 senhas erradas bloqueiam e oferecem redefinir pelo e-mail", async ({ page }, info) => {
  const email = `ninguem-${info.project.name}@demo.marfim.local`;
  await page.goto("/bem-vindo");
  await page.getByRole("button", { name: "Entrar" }).click();
  for (let i = 0; i < 3; i++) {
    await page.getByLabel(/e-?mail/i).fill(email);
    await page.getByLabel(/senha/i).fill("errada" + i);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.locator(".alert.bad")).toBeVisible();
    await expect(page.getByLabel(/senha/i)).toHaveValue(""); // a página recarregou com a resposta
  }
  await expect(page.locator(".alert.bad")).toContainText("bloqueadas por 10 minutos");
  await page.getByRole("link", { name: "Esqueci a senha" }).click();
  await expect(page).toHaveURL(/\/esqueci$/);
});

test("convite → cadastro com código no e-mail → senha → entra no app", async ({ page, browser }, info) => {
  const email = `barbeiro-${info.project.name}@demo.marfim.local`;
  // dono convida
  await page.goto("/bem-vindo");
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.getByLabel(/e-?mail/i).fill(OWNER.email);
  await page.getByLabel(/senha/i).fill(OWNER.password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.goto("/admin/usuarios");
  const form = page.locator("form", { has: page.getByRole("heading", { name: "Convidar pessoa" }) });
  await form.getByLabel("Nome").fill("Barbeiro Convidado");
  await form.getByLabel("E-mail").fill(email);
  await form.locator('select[name="role"]').selectOption("barbeiro");
  await form.getByRole("button", { name: "Enviar convite" }).click();
  await expect(page.locator(".alert.ok")).toContainText("Convite enviado");
  await expect(page.getByText(email)).toBeVisible();

  // convidado, em outro aparelho
  const ctx = await browser.newContext({ baseURL: info.project.use.baseURL, extraHTTPHeaders: info.project.use.extraHTTPHeaders, viewport: page.viewportSize() ?? undefined, colorScheme: info.project.use.colorScheme, locale: "pt-BR", reducedMotion: "reduce" });
  const p2 = await ctx.newPage();
  await p2.goto("/");
  await expect(p2).toHaveURL(/\/bem-vindo$/);
  await p2.getByRole("link", { name: "Cadastrar" }).click();
  await p2.getByRole("link", { name: /Barbeiro colaborador/ }).click();
  await p2.getByLabel("E-mail").fill(email);
  await p2.getByRole("button", { name: "Enviar código" }).click();
  await expect(p2).toHaveURL(/\/verificar/);
  await layoutOk(p2);
  await p2.getByLabel(/Código/).fill("000000" === lastCode(email) ? "111111" : "000000");
  await p2.getByRole("button", { name: "Confirmar" }).click();
  await expect(p2.locator(".alert.bad")).toContainText("Código incorreto");
  await p2.getByLabel(/Código/).fill(lastCode(email));
  await p2.getByRole("button", { name: "Confirmar" }).click();
  await expect(p2).toHaveURL(/\/definir-senha/);
  await expect(p2.getByLabel("Seu nome")).toHaveValue("Barbeiro Convidado");
  await layoutOk(p2);
  await p2.getByLabel(/^Senha/).fill("SenhaDoBarbeiro1");
  await p2.getByLabel("Repita a senha").fill("SenhaDoBarbeiro1");
  await p2.getByRole("button", { name: "Criar senha" }).click();
  await expect(p2).toHaveURL(/\/login/);
  await expect(p2.locator(".alert.ok")).toContainText("Senha criada");
  await p2.getByLabel(/e-?mail/i).fill(email);
  await p2.getByLabel(/senha/i).fill("SenhaDoBarbeiro1");
  await p2.getByRole("button", { name: "Entrar" }).click();
  await p2.waitForURL((u) => u.pathname === "/");
  await expect(p2.locator("#conteudo h1")).toBeVisible();
  await ctx.close();

  await page.reload();
  await expect(page.locator(".row", { hasText: email })).toContainText("acesso criado");
});
