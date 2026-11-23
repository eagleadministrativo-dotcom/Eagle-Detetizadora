// Ensaio da migração V4: aplica 001–004, cria dados no formato antigo, aplica 005, confere, reverte e reaplica. Banco em memória.
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

const dir = path.join(process.cwd(), "db", "migrations");
const sql = (f: string) => fs.readFileSync(path.join(dir, f), "utf8");

async function main() {
  const db = new PGlite("memory://", { extensions: { btree_gist } });
  await db.exec("create table schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  for (const f of ["001_core.sql", "002_accounts_links.sql", "003_push.sql", "004_reminders.sql"]) await db.exec(`${sql(f)}\ninsert into schema_migrations(name) values ('${f}');`);
  await db.exec(`
    insert into organizations(id,name) values ('00000000-0000-0000-0000-000000000001','Org');
    insert into units(id,organization_id,name) values ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','Unidade');
    insert into unit_settings(unit_id) values ('00000000-0000-0000-0000-000000000002');
    insert into users(id,email,full_name,password_hash) values ('00000000-0000-0000-0000-000000000003','a@b.c','Dono','x');
    insert into user_units values ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002','proprietario');
    insert into staff(id,unit_id,user_id,name) values ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','Dono');
    insert into chairs(id,unit_id,name) values ('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000002','C1');
    insert into customers(id,unit_id,name) values ('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000002','Cliente');
    insert into appointments(unit_id,customer_id,staff_id,chair_id,starts_at,ends_at) values ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000005',now(),now()+interval '30 minutes');
    insert into notifications(unit_id,kind,message,is_read) values ('00000000-0000-0000-0000-000000000002','x','lida',true),('00000000-0000-0000-0000-000000000002','x','nova',false);`);
  const snap = async () => JSON.stringify((await db.query("select (select count(*) from users) u,(select count(*) from customers) c,(select count(*) from appointments) a,(select count(*) from notifications) n")).rows[0], (_k, v) => (typeof v === "bigint" ? Number(v) : v));
  const before = await snap();
  const up = async () => db.exec(`${sql("005_v4.sql")}\ninsert into schema_migrations(name) values ('005_v4.sql');`);
  const check = async (label: string, ok: boolean) => { console.log(ok ? "ok  " : "FALHA", label); if (!ok) process.exitCode = 1; };
  await up();
  await check("dados antigos preservados", (await snap()) === before);
  await check("leituras antigas migradas", Number((await db.query<{ n: number }>("select count(*) n from notification_reads")).rows[0].n) === 1);
  await check("sem tabela pública sem RLS", (await db.query("select 1 from pg_tables where schemaname='public' and not rowsecurity")).rows.length === 0);
  await check("visões com security_invoker", (await db.query("select 1 from pg_class where relkind='v' and relnamespace='public'::regnamespace and not coalesce('security_invoker=true' = any(reloptions), false)")).rows.length === 0);
  await db.exec(fs.readFileSync(path.join(process.cwd(), "db", "rollback", "005_v4_down.sql"), "utf8"));
  await check("reversão preserva os dados antigos", (await snap()) === before);
  await check("reversão remove a V4", (await db.query("select 1 from pg_tables where tablename in ('tasks','products','commission_rules','customer_return_status')")).rows.length === 0);
  await up();
  await check("reaplicar depois da reversão", (await snap()) === before);
}
main().catch((e) => { console.error(e); process.exit(1); });
