import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requirePerm } from "@/server/session";
import { getInvite } from "@/server/services/invites";
import { listCatalog } from "@/server/services/catalog";
import { accessPickerProps } from "@/server/permissions";
import { Field, Flash, PageHead } from "@/components/ui";
import { AccessPicker } from "@/components/access-picker";
import { updateInviteAction } from "@/app/actions/admin";

export const metadata = { title: "Editar convite" };

export default async function InviteEdit({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx } = await requirePerm("users.manage");
  const db = await getDb();
  const inv = await getInvite(db, ctx, id).catch(() => null);
  if (!inv || inv.accepted_at || inv.revoked_at) notFound();
  const cat = await listCatalog(db, ctx.unitId);
  const staff = cat.staff.filter((s) => s.is_active && (!s.user_id || s.id === inv.staff_id));
  return (
    <>
      <PageHead title={`Convite de ${inv.full_name}`} sub={`${inv.email} · ainda não aceito`}><Link className="btn ghost" href="/admin/usuarios">Voltar</Link></PageHead>
      <Flash ok={sp.ok} erro={sp.erro} />
      <form action={updateInviteAction} className="card form">
        <input type="hidden" name="id" value={inv.id} />
        <div className="fields">
          <Field label="Nome"><input name="name" defaultValue={inv.full_name} required /></Field>
          <Field label="Técnico da Equipe vinculado"><select name="staffId" defaultValue={inv.staff_id ?? ""}><option value="">—</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        </div>
        <AccessPicker {...accessPickerProps(ctx)} role={inv.role} perms={inv.permissions} />
        <small>Vale quando a pessoa criar o acesso. Não precisa reenviar o convite.</small>
        <div className="sticky-actions"><button className="btn accent" type="submit">Salvar convite</button></div>
      </form>
    </>
  );
}
