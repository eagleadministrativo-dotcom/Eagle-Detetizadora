import { describe, it, expect, beforeAll } from "vitest";
import { makeWorld, type World } from "./testkit";
import { parseContacts, normalizePhone } from "@/lib/contact-import";
import { importCustomers } from "./services/customers";

let w: World;
beforeAll(async () => { w = await makeWorld(); });

describe("leitura de contatos", () => {
  it("normaliza telefones brasileiros", () => {
    expect(normalizePhone("+55 (41) 99999-0000")).toBe("41999990000");
    expect(normalizePhone("041 3333-4444")).toBe("4133334444");
    expect(normalizePhone("99999-0000")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });

  it("lê CSV com ponto e vírgula, acentos e aspas", () => {
    const csv = 'Nome;Celular;E-mail;Nascimento\n"Silva, João";(41) 99999-0001;JOAO@x.com;15/03/1990\nMaria;41 98888-0002;;\nSem Fone;;;\nMaria Repetida;41988880002;;\n';
    const r = parseContacts(csv);
    expect(r.rows.map((x) => x.name)).toEqual(["Silva, João", "Maria"]);
    expect(r.rows[0]).toMatchObject({ phone: "41999990001", email: "joao@x.com", birthdate: "1990-03-15" });
    expect(r.ignored).toBe(2);
  });

  it("lê CSV do Google Contatos (nome em colunas separadas, telefone 1)", () => {
    const csv = "First Name,Last Name,Phone 1 - Label,Phone 1 - Value,E-mail 1 - Value\nAna,Souza,Mobile,+55 41 97777-1111,ana@x.com\n";
    const r = parseContacts(csv);
    expect(r.rows).toEqual([{ name: "Ana Souza", phone: "41977771111", email: "ana@x.com" }]);
  });

  it("lê vCard do celular (várias fichas, linhas dobradas, QUOTED-PRINTABLE)", () => {
    const vcf = [
      "BEGIN:VCARD", "VERSION:3.0", "FN:Carlos Lima", "TEL;TYPE=CELL:+55 41 96666-2222", "EMAIL:c@x.com", "END:VCARD",
      "BEGIN:VCARD", "VERSION:2.1", "N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Jos=C3=A9;=C3=82ngelo;;;", "TEL;CELL:(41) 95555-3333", "END:VCARD",
      "BEGIN:VCARD", "FN:Sem Telefone", "END:VCARD",
    ].join("\r\n");
    const r = parseContacts(vcf);
    expect(r.format).toBe("vcf");
    expect(r.rows.map((x) => [x.name, x.phone])).toEqual([["Carlos Lima", "41966662222"], ["Ângelo José", "41955553333"]]);
    expect(r.ignored).toBe(1);
  });
});

describe("importação de clientes", () => {
  it("cria novos, pula telefone já cadastrado e linhas inválidas, e grava auditoria", async () => {
    const [existing] = await w.db.query<{ phone: string }>("select phone from customers where id=$1", [w.customerId]);
    const phone = existing.phone.replace(/\D/g, "");
    const r = await importCustomers(w.db, w.owner, [
      { name: "Novo Um", phone: "41999990101" },
      { name: "Novo Dois", phone: "(41) 99999-0102", email: "dois@x.com" },
      { name: "Repetido do Banco", phone },
      { name: "Repetido na Lista", phone: "41999990101" },
      { name: "", phone: "41999990103" },
      { name: "Sem Telefone", phone: "123" },
    ]);
    expect(r).toEqual({ created: 2, duplicates: 2, invalid: 2 });
    const [c] = await w.db.query<{ n: number }>("select count(*)::int n from customers where unit_id=$1 and name in ('Novo Um','Novo Dois')", [w.unitId]);
    expect(c.n).toBe(2);
    const [a] = await w.db.query<{ n: number }>("select count(*)::int n from audit_logs where action='CLIENTES_IMPORTADOS'");
    expect(a.n).toBe(1);
    const again = await importCustomers(w.db, w.owner, [{ name: "Novo Um", phone: "41999990101" }]);
    expect(again.created).toBe(0);
  });

  it("exige permissão de gerir clientes", async () => {
    await expect(importCustomers(w.db, w.accountant, [{ name: "X Y", phone: "41999990199" }])).rejects.toThrow();
  });
});
