import { describe, it, expect } from "vitest";
import { normalizePhone } from "./whatsapp";

describe("telefone", () => {
  it("normaliza para o formato internacional", () => {
    expect(normalizePhone("(41) 98403-0971")).toBe("5541984030971");
    expect(normalizePhone("5541984030971")).toBe("5541984030971");
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

import { createDb } from "../db";
import { runReminders } from "./reminders";

describe("lembretes", () => {
  it("a consulta de lembretes roda no banco (sem agendamentos, nada a enviar)", async () => {
    const db = await createDb({ dataDir: "memory://" });
    expect(await runReminders(db)).toEqual({ due: 0, sent: 0, manual: 0 });
  });
});
