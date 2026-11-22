import { createDb, type Db } from "./db";
import { buildPerms, type Ctx, type Role } from "./permissions";
import { setupInitial, createUser } from "./services/bootstrap";
import { saveService, saveStaff } from "./services/catalog";
import { saveCustomer } from "./services/customers";
import { updateSettings } from "./services/catalog";

export interface World {
  db: Db;
  unitId: string;
  owner: Ctx;
  barber: Ctx;
  barber2: Ctx;
  manager: Ctx;
  accountant: Ctx;
  ownerStaffId: string;
  barberStaffId: string;
  barber2StaffId: string;
  serviceId: string;
  service2Id: string;
  customerId: string;
  customer2Id: string;
  chairs: string[];
  methods: Record<string, string>;
  accounts: Record<string, string>;
}

export const ctxFor = (userId: string, unitId: string, role: Role, staffId: string | null = null, overrides: { permission: string; granted: boolean }[] = []): Ctx => ({
  userId, unitId, role, staffId, perms: buildPerms(role, overrides),
});

export async function makeWorld(): Promise<World> {
  const db = await createDb({ dataDir: "memory://" });
  const { unitId, ownerId, staffId } = await setupInitial(db, { orgName: "Teste", unitName: "Unidade Teste", ownerName: "Dono", email: "dono@teste.com", password: "SenhaForte123" });
  const owner = ctxFor(ownerId, unitId, "proprietario", staffId);
  await db.query("insert into chairs(unit_id,name) values ($1,'Cadeira 2')", [unitId]);
  const b1 = await saveStaff(db, owner, { name: "Barbeiro Um", contractType: "pj" });
  const b2 = await saveStaff(db, owner, { name: "Barbeiro Dois", contractType: "clt" });
  const u1 = await createUser(db, owner, { email: "b1@teste.com", fullName: "Barbeiro Um", role: "barbeiro", password: "SenhaForte123", staffId: b1 });
  const u2 = await createUser(db, owner, { email: "b2@teste.com", fullName: "Barbeiro Dois", role: "barbeiro", password: "SenhaForte123", staffId: b2 });
  const um = await createUser(db, owner, { email: "g@teste.com", fullName: "Gerente", role: "gerente", password: "SenhaForte123" });
  const uc = await createUser(db, owner, { email: "c@teste.com", fullName: "Contador", role: "contador", password: "SenhaForte123" });
  const serviceId = await saveService(db, owner, { name: "Corte", durationMinutes: 30, priceCents: 6000 });
  const service2Id = await saveService(db, owner, { name: "Barba", durationMinutes: 30, priceCents: 4000 });
  const customerId = await saveCustomer(db, owner, { name: "Cliente A", phone: "41999990001" });
  const customer2Id = await saveCustomer(db, owner, { name: "Cliente B", phone: "41999990002" });
  const chairs = (await db.query<{ id: string }>("select id from chairs where unit_id=$1 order by name", [unitId])).map((c) => c.id);
  const methods = Object.fromEntries((await db.query<{ id: string; kind: string }>("select id, kind from payment_methods where unit_id=$1", [unitId])).map((m) => [m.kind, m.id]));
  const accounts = Object.fromEntries((await db.query<{ id: string; kind: string }>("select id, kind from financial_accounts where unit_id=$1", [unitId])).map((m) => [m.kind, m.id]));
  await updateSettings(db, owner, { business_hours: {} });
  return {
    db, unitId, owner,
    barber: ctxFor(u1, unitId, "barbeiro", b1),
    barber2: ctxFor(u2, unitId, "barbeiro", b2),
    manager: ctxFor(um, unitId, "gerente"),
    accountant: ctxFor(uc, unitId, "contador"),
    ownerStaffId: staffId, barberStaffId: b1, barber2StaffId: b2, serviceId, service2Id, customerId, customer2Id, chairs, methods, accounts,
  };
}

export const future = (hours: number, minutes = 0) => {
  const d = new Date(Date.now() + hours * 3600000 + minutes * 60000);
  d.setSeconds(0, 0);
  return d;
};
export const key = () => `k-${Math.random().toString(36).slice(2)}-${Date.now()}`;
