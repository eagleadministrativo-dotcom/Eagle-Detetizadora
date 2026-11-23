// Consolida as camadas de CSS (tokens, globals, v4…v8) em um único src/app/styles.css, sem mudar o resultado visual:
//  1) o tema escuro deixa de ser escrito duas vezes: o script /theme.js resolve "automático" e grava data-scheme no <html>,
//     então só existe :root[data-scheme="dark"] (os blocos @media prefers-color-scheme eram cópias);
//  2) declarações sempre sobrescritas (mesmo seletor, mesmo contexto, mesma propriedade mais adiante) são removidas;
//  3) os blocos :root de cada tema são unidos em um só.
// Uso único (migração). Depois de rodar, comparar as capturas de tela: npm run e2e:visual.
import fs from "node:fs";
import postcss from "postcss";

const DIR = "src/app";
const FILES = ["tokens.css", "globals.css", "v4.css", "v5.css", "v6.css", "v7.css", "v8.css"];
const RISKY = /dvh|svh|lvh|cq[iwhb]|color-mix|light-dark|@supports|-webkit-|backdrop-filter|mask/i;

const root = postcss.root();
for (const f of FILES) {
  const r = postcss.parse(fs.readFileSync(`${DIR}/${f}`, "utf8"), { from: f });
  root.append(postcss.comment({ text: `──────────── origem: ${f} ────────────` }));
  root.append(r.nodes);
}

const norm = (sel) => sel.replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").trim();
const declsOf = (rule) => rule.nodes.filter((n) => n.type === "decl").map((d) => `${d.prop}:${d.value}${d.important ? "!" : ""}`).join(";");
const ctxOf = (node) => { const c = []; for (let p = node.parent; p && p.type !== "root"; p = p.parent) if (p.type === "atrule") c.unshift(`@${p.name} ${p.params}`); return c.join(" > "); };

// 1) tema escuro: os blocos dentro de @media (prefers-color-scheme: dark) precisam ter gêmeo em :root[data-theme="dark"]
const darkTwins = new Map();
root.walkRules((r) => { if (!ctxOf(r).includes("prefers-color-scheme") && r.selector.includes(':root[data-theme="dark"]')) darkTwins.set(`${ctxOf(r)}|${norm(r.selector)}`, declsOf(r)); });
const report = { mediaRemoved: 0, converted: [], deadRemoved: 0, rootMerged: 0 };
root.walkAtRules("media", (m) => {
  if (!/prefers-color-scheme:\s*dark/.test(m.params)) return;
  const outer = ctxOf(m);
  m.walkRules((r) => {
    const twinSel = norm(r.selector.replaceAll(':root:not([data-theme="light"])', ':root[data-theme="dark"]'));
    const twin = darkTwins.get(`${outer}|${twinSel}`);
    if (twin === declsOf(r)) return;
    // sem gêmeo idêntico: vira regra normal do tema escuro, no mesmo lugar
    const clone = r.clone({ selector: twinSel });
    m.before(clone);
    report.converted.push(twinSel);
  });
  m.remove();
  report.mediaRemoved++;
});
root.walkRules((r) => { if (r.selector.includes('data-theme="dark"')) r.selector = r.selector.replaceAll(':root[data-theme="dark"]', ':root[data-scheme="dark"]'); });

// 2) declarações mortas: mesmo contexto + mesmo seletor + mesma propriedade mais adiante
const last = new Map();
const all = [];
root.walkDecls((d) => { if (d.parent.type !== "rule") return; const k = `${ctxOf(d.parent)}|${norm(d.parent.selector)}|${d.prop.toLowerCase()}`; all.push([k, d]); last.set(k, d); });
for (const [k, d] of all) {
  const winner = last.get(k);
  if (winner === d || winner.parent === d.parent) continue; // fallback dentro da mesma regra: mantém
  if (d.important && !winner.important) continue;
  if (RISKY.test(winner.value)) continue; // valor que um navegador antigo pode descartar: o anterior serve de reserva
  d.remove();
  report.deadRemoved++;
}

// 3) une os blocos :root (mesmo contexto) no primeiro de cada tipo
for (const sel of [":root", ':root[data-scheme="dark"]']) {
  let first = null;
  root.walkRules((r) => {
    if (norm(r.selector) !== sel || ctxOf(r) !== "") return;
    if (!first) { first = r; return; }
    for (const n of [...r.nodes]) first.append(n);
    r.remove();
    report.rootMerged++;
  });
}

root.walk((n) => { if ((n.type === "rule" || n.type === "atrule") && n.nodes && n.nodes.filter((x) => x.type !== "comment").length === 0 && n.type === "rule") n.remove(); });

const header = `/* MARFIM Studio OS — folha de estilo única.
   Gerada uma vez a partir das camadas antigas (tokens, globals, v4–v8) por scripts/consolidate-css.mjs e mantida à mão daqui em diante.
   Tema: <html data-theme="light|dark"> guarda a escolha da pessoa (sem atributo = automático) e /theme.js grava o tema
   efetivo em data-scheme. O CSS só olha data-scheme: o escuro é escrito uma única vez, em :root[data-scheme="dark"]. */
`;
fs.writeFileSync(`${DIR}/styles.css`, header + root.toString().replace(/\n{3,}/g, "\n\n"));
console.log(JSON.stringify(report, null, 1));
