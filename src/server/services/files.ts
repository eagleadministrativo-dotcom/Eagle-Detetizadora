import type { Db, Q } from "../db";
import { audit, can, need, requireText, requireUuid } from "../core";
import { DomainError, ForbiddenError } from "../errors";
import type { Ctx } from "../permissions";

export const CUSTOMER_FILE_MAX = 5 * 1024 * 1024;
export type CustomerFileKind = "os" | "orcamento" | "outro";
export interface CustomerFileRow { id: string; kind: CustomerFileKind; name: string; mime: string; size_bytes: number; created_at: Date; created_by_name: string | null }

const ALLOWED = /^(application\/pdf|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)|application\/msword|image\/(png|jpeg|webp)|text\/plain)$/;
const BY_EXT: Record<string, string> = {
  pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", doc: "application/msword",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", txt: "text/plain",
};
/** Alguns navegadores mandam o arquivo sem tipo (ou como octet-stream): o tipo vem da extensão. */
export function fileMime(name: string, mime: string | null | undefined): string {
  if (mime && mime !== "application/octet-stream") return mime;
  return BY_EXT[name.toLowerCase().split(".").pop() ?? ""] ?? "application/octet-stream";
}

/** Guarda um arquivo na ficha do cliente. Usa a transação de quem chama (importação cria o arquivo e a OS juntos). */
export async function insertCustomerFile(q: Q, ctx: Ctx, f: { customerId: string; kind: CustomerFileKind; name: string; mime: string; bytes: Buffer }): Promise<string> {
  const name = requireText(f.name, "Nome do arquivo").slice(0, 200);
  if (!f.bytes.length) throw new DomainError("invalid", "O arquivo está vazio.");
  if (f.bytes.length > CUSTOMER_FILE_MAX) throw new DomainError("too_big", "O arquivo passa de 5 MB.");
  const mime = fileMime(name, f.mime);
  if (!ALLOWED.test(mime)) throw new DomainError("invalid", "Tipo de arquivo não aceito. Use PDF, Word, Excel, imagem ou texto.");
  const [c] = await q("select 1 from customers where id=$1 and unit_id=$2", [requireUuid(f.customerId, "Cliente"), ctx.unitId]);
  if (!c) throw new DomainError("not_found", "Cliente não encontrado.");
  const [r] = await q<{ id: string }>(
    "insert into customer_files(unit_id,customer_id,kind,name,mime,size_bytes,content_b64,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id",
    [ctx.unitId, f.customerId, f.kind, name, mime, f.bytes.length, f.bytes.toString("base64"), ctx.userId]);
  await audit(q, ctx, "ARQUIVO_CLIENTE_ANEXADO", "customer_file", r.id, null, { cliente: f.customerId, nome: name, tipo: f.kind, bytes: f.bytes.length });
  return r.id;
}

export async function addCustomerFile(db: Db, ctx: Ctx, f: { customerId: string; kind: CustomerFileKind; name: string; mime: string; bytes: Buffer }) {
  need(ctx, "customers.manage");
  return db.tx((q) => insertCustomerFile(q, ctx, f));
}

export async function listCustomerFiles(db: Db, ctx: Ctx, customerId: string): Promise<CustomerFileRow[]> {
  need(ctx, "customers.view");
  return db.query<CustomerFileRow>(
    `select f.id, f.kind, f.name, f.mime, f.size_bytes, f.created_at, u.full_name as created_by_name
     from customer_files f left join users u on u.id=f.created_by where f.customer_id=$1 and f.unit_id=$2 order by f.created_at desc`,
    [requireUuid(customerId, "Cliente"), ctx.unitId]);
}

export async function getCustomerFile(db: Db, ctx: Ctx, id: string): Promise<{ name: string; mime: string; bytes: Buffer } | null> {
  if (!can(ctx, "customers.view") && !can(ctx, "quotes.view") && !can(ctx, "agenda.manage")) throw new ForbiddenError();
  const [f] = await db.query<{ name: string; mime: string; content_b64: string }>("select name, mime, content_b64 from customer_files where id=$1 and unit_id=$2", [requireUuid(id, "Arquivo"), ctx.unitId]);
  return f ? { name: f.name, mime: f.mime, bytes: Buffer.from(f.content_b64, "base64") } : null;
}

export async function deleteCustomerFile(db: Db, ctx: Ctx, id: string) {
  need(ctx, "customers.manage");
  await db.tx(async (q) => {
    const [f] = await q<{ name: string; customer_id: string }>("delete from customer_files where id=$1 and unit_id=$2 returning name, customer_id", [requireUuid(id, "Arquivo"), ctx.unitId]);
    if (!f) throw new DomainError("not_found", "Arquivo não encontrado.");
    await audit(q, ctx, "ARQUIVO_CLIENTE_EXCLUIDO", "customer_file", id, { nome: f.name, cliente: f.customer_id }, null);
  });
}
