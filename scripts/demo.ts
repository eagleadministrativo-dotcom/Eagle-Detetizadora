import fs from "node:fs";
import path from "node:path";
import { createDb } from "../src/server/db";
import { seedDemo, DEMO_PASSWORD, DEMO_USERS } from "../src/server/demo";

async function main() {
  const dir = process.env.MARFIM_DATA_DIR ?? path.join(process.cwd(), ".data", "demo");
  if (fs.existsSync(dir)) {
    if (process.argv.includes("--reset")) fs.rmSync(dir, { recursive: true, force: true });
    else {
      console.error(`Já existe uma base de demonstração em ${dir}. Use "npm run demo -- --reset" para recriar.`);
      process.exit(1);
    }
  }
  const db = await createDb({ dataDir: dir });
  await seedDemo(db);
  await db.close();
  console.log(`Base de DEMONSTRAÇÃO criada em ${dir} (dados fictícios).`);
  console.log(`Logins (senha ${DEMO_PASSWORD}):`, Object.values(DEMO_USERS).join(", "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
