import { describe, it, expect, beforeAll } from "vitest";
import { createDb, type Db } from "./db";

let db: Db;
beforeAll(async () => {
  db = await createDb({ dataDir: "memory://" });
});

describe("schema", () => {
  it("aplica a migração e barra sobreposição parcial de cadeira e profissional", async () => {
    const [{ id: org }] = await db.query<{ id: string }>("insert into organizations(name) values ('t') returning id");
    const [{ id: unit }] = await db.query<{ id: string }>("insert into units(organization_id,name) values ($1,'u') returning id", [org]);
    const [{ id: chair }] = await db.query<{ id: string }>("insert into chairs(unit_id,name) values ($1,'c1') returning id", [unit]);
    const [{ id: staff }] = await db.query<{ id: string }>("insert into staff(unit_id,name) values ($1,'b') returning id", [unit]);
    const [{ id: cust }] = await db.query<{ id: string }>("insert into customers(unit_id,name) values ($1,'x') returning id", [unit]);
    const ins = (s: string, e: string) =>
      db.query(
        "insert into appointments(unit_id,customer_id,staff_id,chair_id,starts_at,ends_at) values ($1,$2,$3,$4,$5,$6)",
        [unit, cust, staff, chair, s, e],
      );
    await ins("2026-11-23T12:00:00Z", "2026-11-23T13:00:00Z");
    await expect(ins("2026-11-23T12:30:00Z", "2026-11-23T13:30:00Z")).rejects.toThrow();
    await ins("2026-11-23T13:00:00Z", "2026-11-23T14:00:00Z");
  });
  it("audit_logs é imutável e sums bigint viram number", async () => {
    await db.query("insert into audit_logs(action,entity) values ('x','y')");
    await expect(db.query("update audit_logs set action='z'")).rejects.toThrow();
    const [r] = await db.query<{ n: number }>("select count(*) as n from audit_logs");
    expect(typeof r.n).toBe("number");
  });
});
