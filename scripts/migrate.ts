import { createDb } from "../src/server/db";

// Aplica as migrações em DATABASE_URL (ex.: Supabase) ou no banco local de arquivo.
async function main() {
  const db = await createDb();
  const rows = await db.query<{ name: string }>("select name from schema_migrations order by name");
  console.log("Migrações aplicadas:", rows.map((r) => r.name).join(", "));
  await db.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
