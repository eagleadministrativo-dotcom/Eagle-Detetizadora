import { describe, it, expect, beforeAll } from "vitest";
import { makeWorld, type World } from "./testkit";
import { saveCustomer } from "./services/customers";

describe("cadastro de cliente com clique duplo", () => {
  let w: World;
  beforeAll(async () => { w = await makeWorld(); });

  it("o mesmo cliente enviado duas vezes seguidas fica um só; outro nome ou telefone cria outro", async () => {
    const [a, b] = await Promise.all([
      saveCustomer(w.db, w.owner, { name: "Murilo Teste", phone: "41 99876-5432" }),
      saveCustomer(w.db, w.owner, { name: "murilo teste", phone: "41998765432" }),
    ]);
    expect(b).toBe(a);
    const [{ n }] = await w.db.query<{ n: number }>("select count(*)::int as n from customers where lower(name)='murilo teste'");
    expect(n).toBe(1);
    expect(await saveCustomer(w.db, w.owner, { name: "Murilo Teste", phone: "41 99876-0000" })).not.toBe(a);
    expect(await saveCustomer(w.db, w.owner, { name: "Murilo Teste 2", phone: "41 99876-5432" })).not.toBe(a);
  });
});
