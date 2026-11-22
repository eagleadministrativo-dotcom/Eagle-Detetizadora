import { describe, it, expect } from "vitest";
import { parseBRL, fmtBRL, feeCents, splitInstallments, safeDiv } from "./money";
import { addDays, addMonths, atLocal, dayStartUtc, dayEndUtc, monthEnd, previousPeriod, toYmd, dayOfWeek } from "./dates";

describe("dinheiro", () => {
  it("interpreta formatos brasileiros e rejeita lixo", () => {
    expect(parseBRL("12,50")).toBe(1250);
    expect(parseBRL("1.234,56")).toBe(123456);
    expect(parseBRL("R$ 10")).toBe(1000);
    expect(parseBRL("12.5")).toBe(1250);
    expect(parseBRL("1.000.000")).toBe(100000000);
    expect(parseBRL("abc")).toBeNull();
    expect(parseBRL("1,234")).toBeNull();
    expect(parseBRL("")).toBeNull();
    expect(parseBRL("-5")).toBeNull();
  });
  it("formata em reais", () => {
    expect(fmtBRL(123456).replace(/\s/g, " ")).toBe("R$ 1.234,56");
    expect(fmtBRL(null)).toBe("—");
  });
  it("taxas arredondam ao centavo e somam a parte fixa", () => {
    expect(feeCents(10000, 199, 0)).toBe(199);
    expect(feeCents(333, 349, 0)).toBe(12);
    expect(feeCents(1000, 0, 50)).toBe(50);
  });
  it("parcelas fecham o total e divisão por zero é nula", () => {
    expect(splitInstallments(10000, 3).reduce((a, b) => a + b, 0)).toBe(10000);
    expect(safeDiv(1, 0)).toBeNull();
  });
});

describe("datas (America/Sao_Paulo)", () => {
  it("dia local começa às 03:00 UTC e a conversão volta", () => {
    expect(dayStartUtc("2026-11-23").toISOString()).toBe("2026-11-23T03:00:00.000Z");
    expect(dayEndUtc("2026-11-23").toISOString()).toBe("2026-11-24T03:00:00.000Z");
    expect(toYmd(new Date("2026-11-24T02:59:00Z"))).toBe("2026-11-23");
    expect(toYmd(new Date("2026-11-24T03:00:00Z"))).toBe("2026-11-24");
    expect(atLocal("2026-11-23", "14:30").toISOString()).toBe("2026-11-23T17:30:00.000Z");
  });
  it("aritmética de meses respeita fim de mês", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
    expect(monthEnd("2026-02-10")).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(dayOfWeek("2026-11-22")).toBe(0);
  });
  it("período anterior tem a mesma duração", () => {
    expect(previousPeriod({ start: "2026-11-08", end: "2026-11-14" })).toEqual({ start: "2026-11-01", end: "2026-11-07" });
  });
});
