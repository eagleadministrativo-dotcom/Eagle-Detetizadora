"use client";
import { useState, useSyncExternalStore } from "react";
import { parseContacts, normalizePhone, cleanRow, MAX_IMPORT_BYTES, type ImportRow } from "@/lib/contact-import";

type Contact = { name?: string[]; tel?: string[]; email?: string[] };
type ContactsApi = { select(props: string[], opts?: { multiple?: boolean }): Promise<Contact[]> };

export function contactsApi(): ContactsApi | null {
  if (typeof navigator === "undefined") return null;
  const n = navigator as unknown as { contacts?: ContactsApi };
  return n.contacts && typeof n.contacts.select === "function" ? n.contacts : null;
}

const noSubscribe = () => () => {};
/** Se o aparelho tem a agenda de contatos disponível. No servidor é sempre false, para a primeira renderização bater. */
export function useHasContactsApi(): boolean {
  return useSyncExternalStore(noSubscribe, () => !!contactsApi(), () => false);
}

async function readText(f: File): Promise<string> {
  const buf = await f.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buf);
  return utf8.includes("�") ? new TextDecoder("windows-1252").decode(buf) : utf8;
}

export function CustomerImport({ action }: { action: (fd: FormData) => void | Promise<void> }) {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [ignored, setIgnored] = useState(0);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const hasPicker = useHasContactsApi();

  async function onFile(f: File | undefined) {
    setMsg("");
    if (!f) return;
    if (f.size > MAX_IMPORT_BYTES) { setRows([]); setMsg("Arquivo grande demais (máximo 5 MB)."); return; }
    const r = parseContacts(await readText(f));
    setRows(r.rows);
    setIgnored(r.ignored);
    if (!r.rows.length) setMsg("Não encontrei nenhum contato com nome e telefone válidos. Use um arquivo .csv ou .vcf com colunas de nome e telefone (com DDD).");
  }

  async function pick() {
    setMsg("");
    const api = contactsApi();
    if (!api) return;
    try {
      const list = await api.select(["name", "tel", "email"], { multiple: true });
      const out: ImportRow[] = [];
      const seen = new Set<string>();
      let bad = 0;
      for (const c of list) {
        const phone = (c.tel ?? []).map(normalizePhone).find(Boolean) ?? "";
        const r = cleanRow({ name: c.name?.[0], phone, email: c.email?.[0] });
        if (r && !seen.has(r.phone)) { seen.add(r.phone); out.push(r); } else bad++;
      }
      setRows(out);
      setIgnored(bad);
      if (!out.length) setMsg("Nenhum dos contatos escolhidos tem nome e telefone com DDD.");
    } catch { /* a pessoa cancelou */ }
  }

  const n = rows.length;
  return (
    <form action={async (fd) => { setBusy(true); await action(fd); }} className="card form">
      <div className="fields">
        <div>
          <label htmlFor="imp-file"><strong>Arquivo de contatos</strong></label>
          <input id="imp-file" type="file" accept=".csv,.vcf,.txt,text/csv,text/vcard,text/x-vcard" onChange={(e) => void onFile(e.target.files?.[0])} />
          <small>Aceita .csv (Excel, Google Contatos, outros sistemas) e .vcf (contatos do celular). Colunas reconhecidas: nome, telefone/celular, e-mail, CPF, nascimento e observações.</small>
        </div>
        <div>
          <strong>Contatos do celular</strong>
          <div><button type="button" className="btn ghost" onClick={() => void pick()} disabled={!hasPicker}>Escolher nos contatos</button></div>
          <small>{hasPicker ? "Abre a agenda do aparelho para você marcar quem importar." : "Disponível só no Chrome do Android. No iPhone, exporte os contatos em .vcf e envie o arquivo ao lado."}</small>
        </div>
      </div>
      {msg ? <p role="alert" className="alert bad">{msg}</p> : null}
      {n ? (
        <>
          <p><strong>{n}</strong> contato{n === 1 ? "" : "s"} pronto{n === 1 ? "" : "s"} para importar{ignored ? ` · ${ignored} ignorado${ignored === 1 ? "" : "s"} (sem telefone válido ou repetido)` : ""}.</p>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Nome</th><th>Telefone</th><th>E-mail</th></tr></thead>
              <tbody>{rows.slice(0, 8).map((r) => <tr key={r.phone}><td>{r.name}</td><td>{r.phone}</td><td>{r.email ?? "—"}</td></tr>)}</tbody>
            </table>
          </div>
          {n > 8 ? <small>…e mais {n - 8}.</small> : null}
          <input type="hidden" name="payload" value={JSON.stringify(rows)} />
          <div><button className="btn accent" type="submit" disabled={busy}>{busy ? "Importando…" : `Importar ${n} contato${n === 1 ? "" : "s"}`}</button></div>
        </>
      ) : null}
      <small>Dados pessoais são importados só para atender os clientes e podem ser corrigidos ou removidos a pedido deles (LGPD). E-mail, CPF e nascimento só são gravados para quem tem permissão de ver dados sensíveis.</small>
    </form>
  );
}
