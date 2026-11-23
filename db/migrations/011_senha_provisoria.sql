-- 011: senha provisória dos convidados e troca obrigatória no primeiro acesso.
-- Quem entra com a senha provisória não recebe sessão: o app manda um link ao e-mail e a pessoa cria a senha nova.
alter table users add column if not exists must_change_password boolean not null default false;
-- só o hash (scrypt) da senha provisória; o texto nunca fica guardado
alter table unit_settings add column if not exists temp_password_hash text;

-- a trilha do banco mascara também o hash da senha provisória
create or replace function marfim_row_audit() returns trigger as $$
declare
  o jsonb; n jsonb; k text;
  co jsonb := '{}'::jsonb; cn jsonb := '{}'::jsonb;
  app text := coalesce(current_setting('application_name', true), '');
  is_direct boolean := app not in ('marfim-app', '', 'Supavisor');
  noise text[] := array['updated_at', 'last_login_at', 'failed_attempts', 'locked_until'];
  secret text[] := array['password_hash', 'mfa_secret', 'code_hash', 'temp_password_hash', 'endpoint', 'p256dh', 'auth'];
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
alter function marfim_row_audit() set search_path = public, pg_temp;
