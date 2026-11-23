import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup as html } from "react-dom/server";
import { Badge, Empty, ErrorBox, KpiCard, PageHead, Skeleton, ApptBadge } from "./ui";
import { Icon, iconFor } from "./icons";

const kpi = { key: "revenue", label: "Receita operacional", value: 772000, unit: "brl", previous: 441000, definition: "def", formula: "f", source: "s", exclusions: "e" } as never;

describe("componentes de interface", () => {
  it("KpiCard mostra valor em reais, comparativo e link de detalhamento", () => {
    const out = html(h(KpiCard, { k: kpi, href: "/relatorios/revenue", hero: "olive" }));
    expect(out).toContain("R$");
    expect(out).toContain("7.720,00");
    expect(out).toContain("vs anterior");
    expect(out).toContain('href="/relatorios/revenue"');
    expect(out).toContain("kpi hero olive");
  });
  it("KpiCard sinaliza valores ainda não conferidos", () => {
    const out = html(h(KpiCard, { k: { ...(kpi as object), notReconciledCents: 5000 } as never, href: "/x" }));
    expect(out).toContain("ainda não conferido");
  });
  it("estados: vazio, erro e carregamento são acessíveis", () => {
    expect(html(h(Empty, { title: "Sem dados" }))).toContain("Sem dados");
    expect(html(h(ErrorBox, { title: "Falhou" }))).toContain('role="alert"');
    expect(html(h(Skeleton, { h: 20 }))).toContain('aria-hidden="true"');
  });
  it("PageHead exibe eyebrow e título; badges traduzem status", () => {
    const out = html(h(PageHead, { title: "Agenda", eyebrow: "Operação" }));
    expect(out).toContain("Operação");
    expect(out).toContain("<h1 aria-label=\"Agenda\">");
    expect(html(h(ApptBadge, { s: "nao_compareceu" }))).toContain("Não compareceu");
    expect(html(h(Badge, { tone: "ok", children: "ok" }))).toContain("badge ok");
  });
  it("ícones são decorativos e mapeados por rota", () => {
    expect(html(h(Icon, { name: "home" }))).toContain('aria-hidden="true"');
    expect(iconFor("/financeiro/dre")).toBe("chart");
    expect(iconFor("/admin/auditoria")).toBe("shield");
    expect(iconFor("/")).toBe("home");
  });
});
