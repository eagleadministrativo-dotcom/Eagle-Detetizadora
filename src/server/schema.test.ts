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
  it("toda tabela de negócio tem a trilha do banco e RLS ligado", async () => {
    const skip = ["row_changes", "audit_logs", "schema_migrations", "sessions", "job_runs", "error_events", "rate_limits", "notifications", "notification_reads", "notification_deliveries", "domain_events", "automation_runs", "copilot_dismissals"];
    const missing = await db.query<{ t: string }>(
      `select c.relname as t from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not (c.relname = any($1))
         and not exists (select 1 from pg_trigger g where g.tgrelid=c.oid and g.tgname='zz_row_audit')`, [skip]);
    expect(missing.map((m) => m.t), "tabela nova sem trilha: anexe o trigger zz_row_audit na migração").toEqual([]);
    expect(await db.query("select tablename from pg_tables where schemaname='public' and not rowsecurity")).toEqual([]);
  });
  it("trilha do banco: alterações de fora do app ficam marcadas, segredos não são copiados e a trilha é imutável", async () => {
    const [{ id: org }] = await db.query<{ id: string }>("insert into organizations(name) values ('trilha') returning id");
    await db.query("set application_name = 'psql'");
    await db.query("update organizations set name='trilha 2' where id=$1", [org]);
    const [u] = await db.query<{ id: string }>("insert into users(email,full_name,password_hash) values ('t@t.t','T','segredo') returning id");
    await db.query("update users set password_hash='outro', full_name='T2' where id=$1", [u.id]);
    await db.query("set application_name = 'marfim-app'");
    await db.query("insert into organizations(name) values ('do app')");
    const rows = await db.query<{ table_name: string; op: string; direct: boolean; old_data: Record<string, unknown>; new_data: Record<string, unknown> }>("select table_name, op, direct, old_data, new_data from row_changes order by id");
    expect(rows.find((r) => r.table_name === "organizations" && r.op === "UPDATE")).toMatchObject({ direct: true, old_data: { name: "trilha" }, new_data: { name: "trilha 2" } });
    expect(JSON.stringify(rows)).not.toContain("segredo");
    expect(rows.find((r) => r.table_name === "users" && r.op === "UPDATE")?.new_data).toEqual({ full_name: "T2", password_hash: "***" });
    expect(rows.some((r) => r.new_data?.name === "do app")).toBe(false); // inserções do app já têm audit_logs
    await expect(db.query("delete from row_changes")).rejects.toThrow();
    await db.query("reset application_name");
  });
  it("audit_logs é imutável e sums bigint viram number", async () => {
    await db.query("insert into audit_logs(action,entity) values ('x','y')");
    await expect(db.query("update audit_logs set action='z'")).rejects.toThrow();
    const [r] = await db.query<{ n: number }>("select count(*) as n from audit_logs");
    expect(typeof r.n).toBe("number");
  });
});
