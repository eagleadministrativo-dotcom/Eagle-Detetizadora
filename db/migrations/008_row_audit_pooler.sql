-- 008: no Supabase o app passa pelo pooler (Supavisor, modo transação), que não repassa o application_name.
-- Conexões do pooler contam como do aplicativo; editor SQL do painel/API de gestão ("mgmt-api", "postgres-meta"),
-- psql e outras ferramentas conectadas direto continuam marcadas como alteração direta.
-- Limitação conhecida: uma ferramenta externa usando a URL do pooler também seria vista como o app.
create or replace function marfim_row_audit() returns trigger as $$
declare
  o jsonb; n jsonb; k text;
  co jsonb := '{}'::jsonb; cn jsonb := '{}'::jsonb;
  app text := coalesce(current_setting('application_name', true), '');
  is_direct boolean := app not in ('marfim-app', '', 'Supavisor');
  noise text[] := array['updated_at', 'last_login_at', 'failed_attempts', 'locked_until'];
  secret text[] := array['password_hash', 'mfa_secret', 'code_hash', 'endpoint', 'p256dh', 'auth'];
  rid text; uid text;
begin
  if tg_op = 'INSERT' then
    if not is_direct then return null; end if;
    n := to_jsonb(new) - secret;
    rid := n ->> 'id'; uid := n ->> 'unit_id';
  elsif tg_op = 'DELETE' then
    o := to_jsonb(old) - secret;
    rid := o ->> 'id'; uid := o ->> 'unit_id';
  else
    o := to_jsonb(old); n := to_jsonb(new);
    rid := n ->> 'id'; uid := n ->> 'unit_id';
    for k in select jsonb_object_keys(n) loop
      if not (k = any(noise)) and (o -> k) is distinct from (n -> k) then
        if k = any(secret) then
          co := co || jsonb_build_object(k, '***'); cn := cn || jsonb_build_object(k, '***');
        else
          co := co || jsonb_build_object(k, o -> k); cn := cn || jsonb_build_object(k, n -> k);
        end if;
      end if;
    end loop;
    if cn = '{}'::jsonb then return null; end if;
    o := co; n := cn;
  end if;
  insert into row_changes(table_name, op, row_id, unit_id, old_data, new_data, app_name, db_user, direct)
  values (tg_table_name, tg_op, rid, uid, o, n, app, current_user, is_direct);
  return null;
end $$ language plpgsql;
