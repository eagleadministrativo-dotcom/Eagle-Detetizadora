import type { Db } from "../db";
import { audit, can, need, requireText, requireUuid } from "../core";
import { listAppointments } from "./agenda";
import { addDays, dayEndUtc, dayStartUtc, fmtTime, todayYmd, toYmd } from "@/lib/dates";
import { DomainError } from "../errors";
import type { Ctx } from "../permissions";
import { DOC_OPTION_KINDS, composeOptions, type AgendaItem, type DocOption, type DocOptionKind } from "@/lib/doc-options";

/** Opções iniciais, tiradas do modelo de orçamento da Eagle: [tipo, grupo, texto, padrão]. */
const SEED: [DocOptionKind, string | null, string, boolean][] = [
  ["aplicacao", null, "DESINSETIZAÇÃO PULVERIZADA.", true],
  ["aplicacao", null, "DESRATIZAÇÃO: COLOCAÇÃO DE PRODUTOS NAS ISCAS (CAIXAS DE SEGURANÇA), INSTALAÇÃO E PÓ NAS TOCAS.", true],
  ["produto", "Controle de pragas urbanas", "Temprid SC \\ Grupo químico: Neonicotinóide e Piritróide \\ Concentração: I.A.: Imidacloprido 21% e Beta-ciflutrina", true],
  ["produto", "Controle de pragas urbanas", "K-Otrine CE 25 \\ Grupo químico: Piritróide \\ Concentração: I.A. Deltametrina 2,5% p\\p", true],
  ["produto", "Controle de pragas urbanas", "Cyper Server 200 CE \\ Grupo químico: Piretroide \\ Concentração: Cipermetrina 25% e solventes inertes 75% \\ Classe: Inseticida", true],
  ["produto", "Controle de pragas urbanas", "DDVP 1000 \\ Grupo químico: Organofosforado \\ Concentração: 2,2-dichlorovinyl dimethyl phosphate 78% p/p \\ Classe: Inseticida", true],
  ["produto", "Controle de pragas urbanas", "Atratol Gel e Formifim Gel (gel baraticida e formicida)", true],
  ["produto", "Controle de roedores", "Rodilon Soft Bait \\ Grupo químico: Benzotiopiranonas \\ Isca fresca \\ Concentração: I.A.: Difetialona", true],
  ["produto", "Controle de roedores", "Rodilon Bloco extrusado \\ Grupo químico: Benzotiopiranonas \\ Isca bloco \\ Concentração I.A.: Difetialona 0,0025% p\\p", true],
  ["acompanha", null, "Laudos técnicos de desinsetização e desratização", true],
  ["acompanha", null, "Laudo técnico de limpeza de caixas de água", true],
  ["acompanha", null, "Recibo", true],
  ["acompanha", null, "Nota fiscal", true],
  ["acompanha", null, "Boleto", true],
  ["agendamento", null, "Assim que aprovado, de acordo com a necessidade do cliente e a disponibilidade de agenda.", true],
  ["pagamento", null, "Boleto com vencimento a combinar.", true],
  ["pagamento", null, "Boleto 10 dias.", false],
  ["pagamento", null, "Pix.", false],
  ["prazo", null, "Tempo estimado para realização dos serviços de aproximadamente meio dia.", true],
  ["prazo", null, "Tempo estimado para realização dos serviços de aproximadamente 1 dia.", false],
  ["validade", null, "30 dias", true],
  ["validade", null, "15 dias", false],
];

/** Na primeira leitura de cada unidade, cadastra as opções iniciais (uma vez só: excluir tudo depois não traz de volta). */
async function ensureSeeded(db: Db, unitId: string) {
  const [s] = await db.query<{ seeded: boolean }>("select doc_options_seeded as seeded from unit_settings where unit_id=$1", [unitId]);
  if (!s || s.seeded) return;
  await db.tx(async (q) => {
    const [lock] = await q<{ seeded: boolean }>("select doc_options_seeded as seeded from unit_settings where unit_id=$1 for update", [unitId]);
    if (!lock || lock.seeded) return;
    const [any] = await q("select 1 from doc_options where unit_id=$1 limit 1", [unitId]);
    if (!any) {
      for (const [i, [kind, group, text, def]] of SEED.entries()) {
        await q("insert into doc_options(unit_id,kind,group_label,text,sort_order,is_default) values ($1,$2,$3,$4,$5,$6)", [unitId, kind, group, text, i + 1, def]);
      }
    }
    await q("update unit_settings set doc_options_seeded=true where unit_id=$1", [unitId]);
  });
}

export async function listDocOptions(db: Db, unitId: string, opts: { all?: boolean } = {}): Promise<DocOption[]> {
  await ensureSeeded(db, unitId);
  return db.query<DocOption>(
    `select id, kind, group_label, text, sort_order, is_default, is_active from doc_options
     where unit_id=$1 and ($2 or is_active) order by kind, sort_order, created_at`, [unitId, !!opts.all]);
}

export const byKind = (options: DocOption[], kind: DocOptionKind) => options.filter((o) => o.kind === kind);

export interface SaveDocOptionInput { id?: string | null; kind: string; groupLabel?: string | null; text: string; sortOrder?: number | null; isDefault?: boolean; isActive?: boolean }

export async function saveDocOption(db: Db, ctx: Ctx, i: SaveDocOptionInput): Promise<string> {
  need(ctx, "admin.catalog");
  if (!DOC_OPTION_KINDS.includes(i.kind as DocOptionKind)) throw new DomainError("invalid", "Tipo de opção inválido.");
  const text = requireText(i.text?.replace(/\r\n/g, "\n"), "Texto da opção").slice(0, 2000);
  const group = i.kind === "produto" ? i.groupLabel?.trim().replace(/:$/, "") || null : null;
  return db.tx(async (q) => {
    if (i.id) {
      const [r] = await q<{ id: string }>(
        "update doc_options set group_label=$3, text=$4, sort_order=coalesce($5, sort_order), is_default=$6, is_active=$7, updated_at=now() where id=$1 and unit_id=$2 returning id",
        [requireUuid(i.id, "Opção"), ctx.unitId, group, text, i.sortOrder ?? null, !!i.isDefault, i.isActive ?? true]);
      if (!r) throw new DomainError("not_found", "Opção não encontrada.");
      await audit(q, ctx, "OPCAO_DOCUMENTO_EDITADA", "doc_option", r.id, null, { tipo: i.kind, texto: text.slice(0, 80) });
      return r.id;
    }
    const [r] = await q<{ id: string }>(
      `insert into doc_options(unit_id,kind,group_label,text,sort_order,is_default)
       values ($1,$2,$3,$4,coalesce($5,(select coalesce(max(sort_order),0)+1 from doc_options where unit_id=$1 and kind=$2)),$6) returning id`,
      [ctx.unitId, i.kind, group, text, i.sortOrder ?? null, !!i.isDefault]);
    await audit(q, ctx, "OPCAO_DOCUMENTO_CRIADA", "doc_option", r.id, null, { tipo: i.kind, texto: text.slice(0, 80) });
    return r.id;
  });
}

export async function deleteDocOption(db: Db, ctx: Ctx, id: string) {
  need(ctx, "admin.catalog");
  await db.tx(async (q) => {
    const [r] = await q<{ kind: string; text: string }>("delete from doc_options where id=$1 and unit_id=$2 returning kind, text", [requireUuid(id, "Opção"), ctx.unitId]);
    if (!r) throw new DomainError("not_found", "Opção não encontrada.");
    await audit(q, ctx, "OPCAO_DOCUMENTO_EXCLUIDA", "doc_option", id, { tipo: r.kind, texto: r.text.slice(0, 80) }, null);
  });
}

/** Agendamentos reais para a mini agenda (de 7 dias atrás até 6 meses). Quem não vê a agenda recebe a lista vazia. */
export async function agendaForPicker(db: Db, ctx: Ctx): Promise<AgendaItem[]> {
  if (!can(ctx, "agenda.view_all") && !can(ctx, "agenda.view_own")) return [];
  const today = todayYmd();
  const rows = await listAppointments(db, ctx, { from: dayStartUtc(addDays(today, -7)), to: dayEndUtc(addDays(today, 183)) });
  return rows.map((a) => ({ d: toYmd(a.starts_at), t: fmtTime(a.starts_at), who: a.customer_name, staff: a.staff_name }));
}

/** Textos que um orçamento novo recebe: as opções marcadas como padrão. */
export function defaultTexts(options: DocOption[], productsIntro: string | null) {
  const def = (k: DocOptionKind) => byKind(options, k).filter((o) => o.is_default && o.is_active).map((o) => ({ t: o.text, g: o.group_label }));
  return {
    applicationText: composeOptions("aplicacao", def("aplicacao")),
    productsText: composeOptions("produto", def("produto"), { intro: productsIntro }),
    includesText: composeOptions("acompanha", def("acompanha")),
    schedulingText: composeOptions("agendamento", def("agendamento")),
    paymentTerms: composeOptions("pagamento", def("pagamento")),
    executionTime: composeOptions("prazo", def("prazo")),
    validityText: composeOptions("validade", def("validade")),
  };
}
