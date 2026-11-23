import { test, expect, type Page } from "@playwright/test";

/**
 * Varredura de layout em todas as telas do menu (proprietário da DEMONSTRAÇÃO):
 * sem rolagem lateral, sem elementos encavalados, sem número estourando o card, sem erro no console e um único h1.
 * Com VISUAL=1 também compara com capturas de tela locais (e2e/__shots__, fora do git) — usado antes/depois de refatorar CSS.
 */
const OWNER = { email: "dono@demo.marfim.local", password: "Demo@Marfim2026" }; // base fictícia criada pelo seed de demonstração

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/e-?mail/i).fill(OWNER.email);
  await page.getByLabel(/senha/i).fill(OWNER.password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function routes(page: Page): Promise<string[]> {
  const hrefs = await page.$$eval("a[href^='/']", (as) => as.map((a) => a.getAttribute("href")!.split("?")[0].split("#")[0]));
  return [...new Set(["/", ...hrefs])].filter((h) => !h.startsWith("/api") && !h.startsWith("/login") && h !== "/sair").sort();
}

/** Problemas de layout medidos no navegador. */
async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(`rolagem lateral: ${document.documentElement.scrollWidth}px > ${window.innerWidth}px`);
    const visible = (el: Element) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.position !== "absolute" && cs.position !== "fixed"; };
    document.querySelectorAll(".row, .editrow, .dayrow, .grid, .kpis, .nowgrid, .ledger, .heroes, .stats, .filters, .cp-act, .tiles").forEach((c) => {
      const kids = [...c.children].filter(visible).map((k) => ({ k, r: k.getBoundingClientRect() }));
      for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i].r, b = kids[j].r;
        if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2)
          out.push(`sobreposição em .${(c as HTMLElement).className.split(" ")[0]}: "${(kids[i].k.textContent ?? "").trim().slice(0, 30)}" × "${(kids[j].k.textContent ?? "").trim().slice(0, 30)}"`);
      }
    });
    document.querySelectorAll(".kpi .value, .stat .v, .kl-v, h1").forEach((e) => {
      const p = e.parentElement!.getBoundingClientRect(), r = e.getBoundingClientRect();
      if (r.right > p.right + 2) out.push(`texto estourando: "${(e.textContent ?? "").trim().slice(0, 30)}"`);
    });
    const h1 = document.querySelectorAll("main h1, #conteudo h1").length;
    if (h1 !== 1) out.push(`esperado 1 título h1, achou ${h1}`);
    return out;
  });
}

test("todas as telas sem problemas de layout", async ({ page }, info) => {
  test.setTimeout(15 * 60_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource.*(404|401)/i.test(m.text())) errors.push(`${page.url()}: ${m.text()}`); });
  await login(page);
  const list = await routes(page);
  expect(list.length).toBeGreaterThan(20);
  const problems: string[] = [];
  for (const path of list) {
    const res = await page.goto(path);
    expect(res?.status(), `status de ${path}`).toBeLessThan(500);
    // páginas com carregamento em etapas: espera o conteúdo real (título) antes de medir
    await page.locator("#conteudo h1").first().waitFor({ timeout: 15_000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    for (const p of await layoutProblems(page)) problems.push(`${path} → ${p}`);
    // páginas de um registro (endereço com id) mudam a cada base: entram na varredura de layout, não na comparação de imagens
    if (process.env.VISUAL && !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(path)) {
      await expect.soft(page).toHaveScreenshot(`${path === "/" ? "inicio" : path.slice(1).replaceAll("/", "_")}.png`, {
        fullPage: true, animations: "disabled", maxDiffPixelRatio: 0.002,
        mask: [page.locator(".pagehead p"), page.locator(".livetoast"), page.locator(".chart"), page.locator("time")],
      });
    }
  }
  info.annotations.push({ type: "telas", description: String(list.length) });
  expect(problems, problems.join("\n")).toEqual([]);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("copiloto dispensa sugestão e a escolha vale após recarregar", async ({ page }) => {
  await login(page);
  await page.goto("/");
  const items = page.locator(".copilot .cp");
  const n = await items.count();
  test.skip(n === 0, "sem sugestões na base de demonstração hoje");
  const title = await items.first().locator("b").innerText();
  await page.getByRole("button", { name: `Dispensar até amanhã: ${title}` }).click();
  await expect(page.locator(".copilot .cp b", { hasText: title })).toHaveCount(0);
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.locator(".copilot .cp b", { hasText: title })).toHaveCount(0);
});

test("saúde do sistema e versão da agenda respondem", async ({ page }) => {
  await login(page);
  await page.goto("/admin/saude");
  await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(/Saúde do sistema/);
  const v = await page.evaluate(async () => (await fetch("/api/agenda/versao")).json());
  expect(typeof v.v).toBe("string");
});
