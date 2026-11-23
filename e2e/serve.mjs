// Servidor dos testes de ponta a ponta: recria a base de DEMONSTRAÇÃO (dados fictícios) e sobe o app já compilado.
import { spawnSync, spawn } from "node:child_process";
const env = { ...process.env, MARFIM_DATA_DIR: ".data/e2e" };
const seed = spawnSync("npx", ["tsx", "scripts/demo.ts", "--reset"], { stdio: "inherit", env, shell: true });
if (seed.status !== 0) process.exit(seed.status ?? 1);
const port = process.env.E2E_PORT ?? "3200";
const child = spawn("npx", ["next", "start", "-p", port], { stdio: "inherit", env, shell: true });
child.on("exit", (c) => process.exit(c ?? 0));
