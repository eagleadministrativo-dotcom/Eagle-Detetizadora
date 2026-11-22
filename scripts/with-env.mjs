// Uso: node scripts/with-env.mjs CHAVE=valor [CHAVE=valor...] -- comando args
import { spawn } from "node:child_process";
const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
const env = { ...process.env };
for (const kv of argv.slice(0, sep)) { const [k, ...v] = kv.split("="); env[k] = v.join("="); }
const [cmd, ...args] = argv.slice(sep + 1);
const child = spawn(cmd, args, { stdio: "inherit", env, shell: true });
child.on("exit", (c) => process.exit(c ?? 0));
