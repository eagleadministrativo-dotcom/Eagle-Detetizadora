import fs from "node:fs";
import { createDb } from "../src/server/db";
import { restoreBackup } from "../src/server/services/ops";

// Uso: RESTORE_OWNER_EMAIL=... RESTORE_OWNER_PASSWORD=... npm run db:restore -- caminho/backup.json
// O destino (DATABASE_URL ou banco local) precisa estar vazio.
async function main() {
  const file = process.argv[2];
  const email = process.env.RESTORE_OWNER_EMAIL, password = process.env.RESTORE_OWNER_PASSWORD;
  if (!file || !email || !password) throw new Error("Informe o arquivo de backup e as variáveis RESTORE_OWNER_EMAIL e RESTORE_OWNER_PASSWORD.");
  const db = await createDb();
  await restoreBackup(db, fs.readFileSync(file, "utf8"), email, password);
  await db.close();
  console.log("Backup restaurado. Os demais usuários precisam de nova senha (Administração → Usuários).");
}
main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
