"use client";
import { useState } from "react";

type Group = { title: string; hint?: string; items: [string, string][] };

/**
 * Cargo + o que a pessoa acessa, página por página. Trocar o cargo pré-marca o padrão dele; depois é só ajustar.
 * Envia `role` e um `perm` para cada caixa marcada.
 */
export function AccessPicker({ roles, defaults, groups, role: initialRole, perms, cannot = [], roleLocked }: {
  roles: { value: string; label: string }[]; defaults: Record<string, string[]>; groups: Group[];
  role: string; perms?: string[] | null; cannot?: string[]; roleLocked?: boolean;
}) {
  const [role, setRole] = useState(initialRole);
  const [on, setOn] = useState(() => new Set(perms ?? defaults[initialRole] ?? []));
  const toggle = (k: string) => setOn((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const admin = role === "administrador";

  return (
    <div className="stack">
      <div className="fields">
        <label>Cargo
          <select name="role" value={role} disabled={roleLocked} onChange={(e) => { setRole(e.target.value); setOn(new Set(defaults[e.target.value] ?? [])); }}>
            {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        {roleLocked ? <input type="hidden" name="role" value={role} /> : null}
      </div>
      {admin ? <p className="muted">Administrador tem acesso a tudo, sem exceção.</p> : (
        <>
          <div className="row">
            <small className="grow muted">Marque o que a pessoa pode ver e fazer. Ao trocar o cargo, as marcações voltam ao padrão dele.</small>
            <button type="button" className="btn small ghost" onClick={() => setOn(new Set(defaults[role] ?? []))}>Voltar ao padrão do cargo</button>
          </div>
          <div className="permgrid">
            {groups.map((g) => (
              <fieldset key={g.title}>
                <legend>{g.title}</legend>
                {g.hint ? <small className="muted">{g.hint}</small> : null}
                {g.items.map(([k, l]) => {
                  const blocked = cannot.includes(k) && !on.has(k);
                  return (
                    <label key={k} className="check">
                      <input type="checkbox" name="perm" value={k} checked={on.has(k)} disabled={blocked} onChange={() => toggle(k)} />
                      {l}{blocked ? <small> (você não tem)</small> : null}
                    </label>
                  );
                })}
              </fieldset>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
