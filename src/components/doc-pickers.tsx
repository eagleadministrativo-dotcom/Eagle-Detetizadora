import { Field } from "@/components/ui";
import { matchOptions, type ComposeKind, type Picked } from "@/lib/doc-options";

/** Uma opção que pode ser marcada: texto que entra no documento, grupo (produtos), id (serviço) e se vem marcada no documento novo. */
export interface PickOption { key: string; text: string; label?: string; group?: string | null; id?: string | null; isDefault?: boolean }

const val = (p: Picked) => JSON.stringify(p);

/**
 * Lista de opções para marcar. No documento novo vêm marcadas as opções padrão; ao editar, as que já estão no texto.
 * O que estiver no texto e não for opção cadastrada aparece marcado como "texto anterior" (desmarque para tirar).
 */
export function OptionChecklist({ name, kind, label, options, current, isNew, intro, empty, attrs }: {
  name: string; kind: ComposeKind; label: string; options: PickOption[]; current?: string | null; isNew: boolean; intro?: string | null;
  empty?: React.ReactNode; attrs?: (o: PickOption) => Record<string, string>;
}) {
  const found = isNew ? null : matchOptions(kind, current, options, intro);
  // novo, ou texto salvo sem nenhum item reconhecível (ex.: arquivo importado com a lista de produtos em imagem): vêm as opções padrão
  const useDefaults = !found || (!!current?.trim() && !found.checked.size && !found.extra.length);
  const { checked, extra } = useDefaults ? { checked: new Set(options.filter((o) => o.isDefault)), extra: [] as string[] } : found!;
  return (
    <fieldset className="optlist">
      <legend>{label}</legend>
      {options.length === 0 && !extra.length ? <small className="muted">{empty ?? "Nenhuma opção cadastrada."}</small> : null}
      {options.map((o, i) => {
        // título do grupo (produtos) quando o grupo muda em relação à opção anterior
        const head = o.group && o.group !== options[i - 1]?.group ? <p className="optgroup">{o.group}</p> : null;
        return (
          <div key={o.key}>
            {head}
            <label className="check opt">
              <input type="checkbox" name={name} value={val({ t: o.text, g: o.group ?? null, id: o.id ?? null })} defaultChecked={checked.has(o)} {...(attrs?.(o) ?? {})} />
              <span>{o.label ?? o.text}</span>
            </label>
          </div>
        );
      })}
      {extra.map((t, i) => (
        <label className="check opt" key={`x${i}`}>
          <input type="checkbox" name={name} value={val({ t, raw: true })} defaultChecked />
          <span>{t} <small className="muted">(texto anterior)</small></span>
        </label>
      ))}
    </fieldset>
  );
}

/** Escolher uma opção (pagamento, prazo, validade, agendamento). Se o texto salvo não for uma opção, ele continua disponível. */
export function OptionSelect({ name, label, options, current, isNew, none = "— nenhum —" }: {
  name: string; label: string; options: PickOption[]; current?: string | null; isNew: boolean; none?: string;
}) {
  const cur = (current ?? "").trim();
  const def = isNew ? options.find((o) => o.isDefault)?.text ?? "" : cur;
  const known = options.some((o) => o.text === def);
  return (
    <Field label={label}>
      <select name={name} defaultValue={def}>
        <option value="">{none}</option>
        {options.map((o) => <option key={o.key} value={o.text}>{o.text}</option>)}
        {def && !known ? <option value={def}>{def} (texto anterior)</option> : null}
      </select>
    </Field>
  );
}
