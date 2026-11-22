import { describe, it, expect, beforeAll } from "vitest";
import { createDb, type Db } from "../db";
import { setupInitial, createUser } from "./bootstrap";
import { buildPerms } from "../permissions";
import { flushPush, saveSubscription, validateSubscription, countSubscriptions, removeSubscription, type PushPayload } from "./push";

let db: Db;
let ownerId: string;
let unitId: string;
let barberId: string;
const sub = (n: string) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: `p-${n}`, auth: `a-${n}` } });

beforeAll(async () => {
  db = await createDb({ dataDir: "memory://" });
  const r = await setupInitial(db, { orgName: "T", unitName: "U", ownerName: "Dono", email: "dono@t.com", password: "SenhaForte123" });
  ownerId = r.ownerId;
  unitId = r.unitId;
  const owner = { userId: ownerId, unitId, role: "proprietario" as const, perms: buildPerms("proprietario", []) };
  barberId = (await createUser(db, owner, { email: "b@t.com", fullName: "Barbeiro", role: "barbeiro", password: "SenhaForte123" }));
});

describe("notificações push", () => {
  it("valida a inscrição recebida do navegador", () => {
    expect(() => validateSubscription({ endpoint: "http://inseguro", keys: { p256dh: "a", auth: "b" } })).toThrow();
    expect(() => validateSubscription({ endpoint: "https://x/y" })).toThrow();
    expect(validateSubscription(sub("ok")).endpoint).toBe("https://push.example/ok");
  });

  it("envia só ao proprietário/gerente, uma única vez, e remove inscrição expirada", async () => {
    await saveSubscription(db, ownerId, sub("dono"));
    await saveSubscription(db, ownerId, sub("morta"));
    await saveSubscription(db, barberId, sub("barbeiro"));
    await saveSubscription(db, ownerId, sub("dono")); // repetir não duplica
    expect(await countSubscriptions(db, ownerId)).toBe(2);

    await db.query("update notifications set pushed_at=now()"); // ignora avisos já existentes
    await db.query("insert into notifications(unit_id,kind,severity,message,dedupe_key) values ($1,'teste','critico','Caixa com diferença','t1')", [unitId]);

    const got: { endpoint: string; payload: PushPayload }[] = [];
    const sender = async (s: { endpoint: string }, payload: PushPayload) => {
      if (s.endpoint.endsWith("/morta")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      got.push({ endpoint: s.endpoint, payload });
    };
    const r1 = await flushPush(db, sender);
    expect(r1).toEqual({ notifications: 1, sent: 1, removed: 1 });
    expect(got.map((g) => g.endpoint)).toEqual(["https://push.example/dono"]);
    expect(got[0].payload.body).toBe("Caixa com diferença");
    expect(got[0].payload.severity).toBe("critico");
    expect(await countSubscriptions(db, ownerId)).toBe(1);

    const r2 = await flushPush(db, sender); // já enviado: não repete
    expect(r2.notifications).toBe(0);
    expect(got).toHaveLength(1);
  });

  it("aviso pessoal vai só ao usuário indicado; remover inscrição funciona", async () => {
    await db.query("insert into notifications(unit_id,user_id,kind,severity,message,dedupe_key) values ($1,$2,'pessoal','info','Só para você','t2')", [unitId, barberId]);
    const got: string[] = [];
    await flushPush(db, async (s) => { got.push(s.endpoint); });
    expect(got).toEqual(["https://push.example/barbeiro"]);
    await removeSubscription(db, barberId, "https://push.example/barbeiro");
    expect(await countSubscriptions(db, barberId)).toBe(0);
  });

  it("sem chaves VAPID e sem remetente, não faz nada nem consome avisos", async () => {
    await db.query("insert into notifications(unit_id,kind,severity,message,dedupe_key) values ($1,'x','info','y','t3')", [unitId]);
    expect(await flushPush(db)).toEqual({ notifications: 0, sent: 0, removed: 0 });
    const [n] = await db.query<{ pushed_at: Date | null }>("select pushed_at from notifications where dedupe_key='t3'");
    expect(n.pushed_at).toBeNull();
  });
});
