// Servidor dos testes de ponta a ponta: recria a base de DEMONSTRAÇÃO (dados fictícios) e sobe o app já compilado.
// E-mails (convites e códigos) não saem: ficam como arquivos em .data/e2e-mail, lidos pelos testes.
import fs from "node:fs";
import { spawnSync, spawn } from "node:child_process";
const MAIL = ".data/e2e-mail";
fs.rmSync(MAIL, { recursive: true, force: true });
const env = { ...process.env, MARFIM_DATA_DIR: ".data/e2e", MAIL_OUTBOX_DIR: MAIL };
const seed = spawnSync("npx", ["tsx", "scripts/demo.ts", "--reset"], { stdio: "inherit", env, shell: true });
if (seed.status !== 0) process.exit(seed.status ?? 1);
const port = process.env.E2E_PORT ?? "3200";
const child = spawn("npx", ["next", "start", "-p", port], { stdio: "inherit", env, shell: true });
child.on("exit", (c) => process.exit(c ?? 0));
