import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

export type Q = <T = Record<string, any>>(sql: string, params?: unknown[]) => Promise<T[]>;

export interface Db {
  query: Q;
  exec(sql: string): Promise<void>;
  tx<R>(fn: (q: Q) => Promise<R>): Promise<R>;
  /** Exclusão mútua entre instâncias (só PostgreSQL real): evita migrações concorrentes em cold start. */
  withLock?<R>(fn: () => Promise<R>): Promise<R>;
  close(): Promise<void>;
}

const INT8 = 20;
const toNumber = (v: string) => Number(v);

function pgliteDb(dataDir: string): Db {
  if (!dataDir.includes("://")) fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(dataDir), { recursive: true });
  const pg = new PGlite(dataDir, { extensions: { btree_gist }, parsers: { [INT8]: toNumber } });
  const mk = (t: { query: PGlite["query"] }): Q =>
    async <T,>(sql: string, params: unknown[] = []) => (await t.query(sql, params)).rows as T[];
  return {
    query: mk(pg),
    async exec(sql) {
      await pg.exec(sql);
    },
    async tx(fn) {
      return pg.transaction(async (t) => fn(mk(t)));
    },
    async close() {
      await pg.close();
    },
  };
}

/**
 * Na Vercel cada cópia do servidor abre conexões próprias; o pooler do Supabase em modo sessão (porta 5432) prende uma
 * conexão do banco por cliente e esgota rápido. O modo transação (porta 6543) libera a conexão a cada operação.
 */
export function serverlessDbUrl(url: string): string {
  return url.replace(/(\.pooler\.supabase\.com):5432(?=\/|$|\?)/, "$1:6543");
}

// Caminho de produção (Supabase/Postgres).
async function postgresDb(rawUrl: string): Promise<Db> {
  const { Pool, types } = await import("pg");
  types.setTypeParser(INT8, toNumber);
  const url = serverlessDbUrl(rawUrl);
  const pool = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 5000, application_name: "marfim-app", ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: false } });
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      return (await pool.query(sql, params as any[])).rows as T[];
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query("begin");
        const q: Q = async <T,>(sql: string, params: unknown[] = []) => (await c.query(sql, params as any[])).rows as T[];
        const out = await fn(q);
        await c.query("commit");
        return out;
      } catch (e) {
        await c.query("rollback");
        throw e;
      } finally {
        c.release();
      }
    },
    async withLock<R>(fn: () => Promise<R>) {
      const c = await pool.connect();
      try {
        // Lock de transação: funciona também no pooler em modo transação (Supabase, porta 6543).
        await c.query("begin");
        await c.query("select pg_advisory_xact_lock(727274)");
        const out = await fn();
        await c.query("commit");
        return out;
      } catch (e) {
        await c.query("rollback").catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

export async function migrate(db: Db, dir = path.join(/*turbopackIgnore: true*/ process.cwd(), "db", "migrations")) {
  return db.withLock ? db.withLock(() => migrateUnlocked(db, dir)) : migrateUnlocked(db, dir);
}

async function migrateUnlocked(db: Db, dir: string) {
  await db.exec("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await db.query<{ name: string }>("select name from schema_migrations")).map((r) => r.name));
  const files = fs.readdirSync(/*turbopackIgnore: true*/ dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(/*turbopackIgnore: true*/ dir, f), "utf8");
    await db.exec(`${sql}\ninsert into schema_migrations(name) values ('${f}');`);
  }
}

export async function createDb(opts: { dataDir?: string; url?: string } = {}): Promise<Db> {
  const url = opts.url ?? process.env.DATABASE_URL;
  if (!url && !opts.dataDir && !process.env.MARFIM_DATA_DIR && process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL não configurada. Em produção o sistema exige um PostgreSQL (ex.: Supabase); o banco local de arquivo é apenas para desenvolvimento e demonstração.");
  }
  const db = url ? await postgresDb(url) : pgliteDb(opts.dataDir ?? process.env.MARFIM_DATA_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), ".data", "pglite"));
  await migrate(db);
  return db;
}

const g = globalThis as unknown as { __marfimDb?: Promise<Db> };
export function getDb(): Promise<Db> {
  g.__marfimDb ??= createDb();
  return g.__marfimDb;
}
