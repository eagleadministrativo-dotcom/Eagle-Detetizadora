-- 007: operação e segurança.
-- 1) Trilha de alterações no próprio banco (row_changes): pega também o que for alterado fora do aplicativo.
-- 2) Registro das rotinas (job_runs) e dos erros do servidor (error_events).
-- 3) Limite de tentativas por origem (rate_limits).
-- 4) Códigos de recuperação da verificação em duas etapas.
-- 5) Sugestões do copiloto dispensadas.

create table if not exists row_changes (
  id bigserial primary key,
  at timestamptz not null default now(),
  table_name text not null,
  op text not null,
  row_id text,
  unit_id text,
  old_data jsonb,
  new_data jsonb,
  app_name text,
  db_user text,
  direct boolean not null default false
);
create index if not exists row_changes_at_idx on row_changes (at desc);
create index if not exists row_changes_direct_idx on row_changes (at desc) where direct;
create index if not exists row_changes_row_idx on row_changes (table_name, row_id);

create or replace function row_changes_immutable() returns trigger as $$
begin
  raise exception 'row_changes é imutável';
end $$ language plpgsql;
drop trigger if exists row_changes_no_change on row_changes;
create trigger row_changes_no_change before update or delete on row_changes for each row execute function row_changes_immutable();

/*
  O aplicativo se conecta com application_name = 'marfim-app'. Qualquer outra origem (editor SQL, ferramentas) é "direct".
  Inserções feitas pelo aplicativo já têm auditoria própria (audit_logs) e não são duplicadas aqui; alterações e exclusões
  sempre entram. Colunas secretas nunca são copiadas, e campos de controle (updated_at, tentativas de login) não contam como alteração.
*/
create or replace function marfim_row_audit() returns trigger as $$
declare
  o jsonb; n jsonb; k text;
  co jsonb := '{}'::jsonb; cn jsonb := '{}'::jsonb;
  app text := coalesce(current_setting('application_name', true), '');
  is_direct boolean := app not in ('marfim-app', '');
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

create table if not exists job_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'rodando' check (status in ('rodando', 'ok', 'erro')),
  summary jsonb,
  error text
);
create index if not exists job_runs_job_idx on job_runs (job, started_at desc);

create table if not exists error_events (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  kind text not null default 'request',
  path text,
  method text,
  digest text,
  message text not null,
  stack text
);
create index if not exists error_events_at_idx on error_events (at desc);

create table if not exists rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  hits integer not null default 0
);

create table if not exists mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists mfa_recovery_user_idx on mfa_recovery_codes (user_id) where used_at is null;

create table if not exists copilot_dismissals (
  user_id uuid not null references users(id) on delete cascade,
  insight_id text not null,
  dismissed_on date not null default current_date,
  reason text,
  created_at timestamptz not null default now(),
  primary key (user_id, insight_id, dismissed_on)
);

-- Liga a trilha em todas as tabelas de negócio. Ficam de fora as próprias trilhas/registros e as de alto volume técnico.
do $$
declare t text;
begin
  for t in
    select c.relname from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relkind = 'r'
      and c.relname not in ('row_changes', 'audit_logs', 'schema_migrations', 'sessions', 'job_runs', 'error_events', 'rate_limits',
        'notifications', 'notification_reads', 'notification_deliveries', 'domain_events', 'automation_runs', 'copilot_dismissals')
  loop
    execute format('drop trigger if exists zz_row_audit on %I', t);
    execute format('create trigger zz_row_audit after insert or update or delete on %I for each row execute function marfim_row_audit()', t);
  end loop;
end $$;

-- Nenhuma tabela fica exposta pela API pública do Supabase: acesso só pelo servidor do aplicativo.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;
