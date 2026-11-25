-- Eagle Detetizadora OS — núcleo. Valores em centavos (integer). Datas em timestamptz (UTC).
create extension if not exists btree_gist;

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  name text not null,
  created_at timestamptz not null default now()
);

create table unit_settings (
  unit_id uuid primary key references units(id) on delete restrict,
  timezone text not null default 'America/Sao_Paulo',
  currency text not null default 'BRL',
  business_hours jsonb not null default '{}'::jsonb,
  retroactive_edit_days integer not null default 7 check (retroactive_edit_days >= 0),
  discount_owner_only boolean not null default true,
  discount_limit_bps integer check (discount_limit_bps between 0 and 10000),
  no_show_policy text not null default 'apenas_registrar' check (no_show_policy in ('apenas_registrar','cobrar_taxa')),
  no_show_fee_cents integer check (no_show_fee_cents >= 0),
  tax_regime text,
  customer_retention_months integer,
  notification_channels jsonb not null default '["sistema"]'::jsonb,
  mfa_required boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text not null,
  password_hash text not null,
  is_active boolean not null default true,
  mfa_secret text,
  mfa_enabled boolean not null default false,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index users_email_uq on users (lower(email));

create table user_units (
  user_id uuid not null references users(id) on delete restrict,
  unit_id uuid not null references units(id) on delete restrict,
  role text not null check (role in ('administrador','gerente','vendedora_gestora','vendedor','tecnico','colaborador','pendente')),
  primary key (user_id, unit_id)
);

create table permission_overrides (
  user_id uuid not null references users(id) on delete restrict,
  unit_id uuid not null references units(id) on delete restrict,
  permission text not null,
  granted boolean not null,
  primary key (user_id, unit_id, permission)
);

create table sessions (
  id text primary key,
  user_id uuid not null references users(id) on delete cascade,
  unit_id uuid not null references units(id) on delete restrict,
  mfa_verified boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table chairs (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table staff (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  user_id uuid references users(id) on delete restrict,
  name text not null,
  phone text,
  contract_type text check (contract_type in ('clt','pj','autonomo','administrador','socio')),
  color text not null default '#8B6B4A',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table staff_schedules (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff(id) on delete cascade,
  day_of_week integer not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  check (end_time > start_time)
);

create table schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  chair_id uuid references chairs(id),
  staff_id uuid references staff(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  check (ends_at > starts_at)
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  name text not null,
  phone text,
  email text,
  cpf text,
  birthdate date,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id)
);
create index customers_unit_name_idx on customers (unit_id, lower(name));

create table service_categories (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true
);

create table services (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  category_id uuid references service_categories(id),
  name text not null,
  description text,
  duration_minutes integer not null check (duration_minutes > 0),
  buffer_minutes integer not null default 0 check (buffer_minutes >= 0),
  color text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table service_staff (
  service_id uuid not null references services(id) on delete cascade,
  staff_id uuid not null references staff(id) on delete cascade,
  primary key (service_id, staff_id)
);

create table service_prices (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references services(id) on delete restrict,
  staff_id uuid references staff(id),
  price_cents integer not null check (price_cents >= 0),
  valid_from timestamptz not null default now(),
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index service_prices_lookup_idx on service_prices (service_id, valid_from desc);

create table service_custom_fields (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references services(id) on delete cascade,
  label text not null,
  value text not null default ''
);

create table payment_methods (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  name text not null,
  kind text not null check (kind in ('dinheiro','pix','cartao_credito','cartao_debito','outro')),
  fee_bps integer not null default 0 check (fee_bps between 0 and 10000),
  fee_fixed_cents integer not null default 0 check (fee_fixed_cents >= 0),
  settlement_days integer not null default 0 check (settlement_days >= 0),
  is_active boolean not null default true,
  sort_order integer not null default 0
);

create table financial_accounts (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  name text not null,
  kind text not null check (kind in ('caixa','banco','virtual')),
  is_active boolean not null default true
);

create table financial_categories (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  name text not null,
  kind text not null check (kind in ('receita','custo','despesa','imposto','nao_operacional','pro_labore','distribuicao_lucros')),
  account_code text,
  sort_order integer not null default 0,
  is_active boolean not null default true
);

-- Agenda: conflitos barrados no banco (sobreposição parcial incluída)
create table appointments (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  customer_id uuid not null references customers(id),
  staff_id uuid not null references staff(id),
  chair_id uuid not null references chairs(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'agendado' check (status in ('agendado','em_atendimento','concluido','cancelado','nao_compareceu')),
  cancellation_reason text,
  cancelled_by uuid references users(id),
  cancelled_at timestamptz,
  notes text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id),
  check (ends_at > starts_at),
  constraint appointments_chair_no_overlap exclude using gist (
    chair_id with =, tstzrange(starts_at, ends_at) with &&
  ) where (status in ('agendado','em_atendimento','concluido')),
  constraint appointments_staff_no_overlap exclude using gist (
    staff_id with =, tstzrange(starts_at, ends_at) with &&
  ) where (status in ('agendado','em_atendimento','concluido'))
);
create index appointments_unit_start_idx on appointments (unit_id, starts_at);
create index appointments_staff_start_idx on appointments (staff_id, starts_at);

create table appointment_services (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id) on delete cascade,
  service_id uuid not null references services(id),
  name_snapshot text not null,
  price_cents integer not null check (price_cents >= 0),
  duration_minutes integer not null check (duration_minutes > 0)
);

create table attendances (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  appointment_id uuid not null unique references appointments(id),
  staff_id uuid not null references staff(id),
  chair_id uuid not null references chairs(id),
  customer_id uuid not null references customers(id),
  status text not null default 'iniciado' check (status in ('iniciado','concluido','cancelado')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  subtotal_cents integer not null default 0 check (subtotal_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  discount_reason text,
  discount_authorized_by uuid references users(id),
  total_cents integer not null default 0 check (total_cents >= 0),
  created_by uuid references users(id),
  updated_at timestamptz not null default now(),
  check (discount_cents <= subtotal_cents)
);
create index attendances_unit_finished_idx on attendances (unit_id, finished_at);

create table attendance_items (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null references attendances(id) on delete cascade,
  service_id uuid references services(id),
  name_snapshot text not null,
  quantity integer not null default 1 check (quantity > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  line_total_cents integer not null check (line_total_cents >= 0)
);

create table receivables (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  attendance_id uuid unique references attendances(id),
  customer_id uuid references customers(id),
  description text not null,
  amount_due_cents integer not null check (amount_due_cents >= 0),
  due_date date not null default current_date,
  status text not null default 'ativo' check (status in ('ativo','cancelado')),
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index receivables_unit_idx on receivables (unit_id, status);

create table cash_sessions (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  account_id uuid not null references financial_accounts(id),
  status text not null default 'aberto' check (status in ('aberto','fechado')),
  opened_by uuid not null references users(id),
  opened_at timestamptz not null default now(),
  opening_declared_cents integer not null default 0 check (opening_declared_cents >= 0),
  closed_by uuid references users(id),
  closed_at timestamptz,
  closing_declared jsonb,
  closing_expected jsonb,
  difference_cents integer,
  justification text,
  corrections jsonb not null default '[]'::jsonb
);
create unique index cash_sessions_one_open_uq on cash_sessions (account_id) where status = 'aberto';

create table payments (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  receivable_id uuid not null references receivables(id),
  method_id uuid not null references payment_methods(id),
  cash_session_id uuid references cash_sessions(id),
  kind text not null default 'recebimento' check (kind in ('recebimento','estorno')),
  reversal_of uuid references payments(id),
  amount_cents integer not null check (amount_cents > 0),
  fee_cents integer not null default 0 check (fee_cents >= 0),
  status text not null default 'registrado' check (status in ('registrado','confirmado','liquidado')),
  idempotency_key text not null unique,
  reference text,
  paid_at timestamptz not null default now(),
  registered_by uuid not null references users(id),
  registered_at timestamptz not null default now(),
  confirmed_by uuid references users(id),
  confirmed_at timestamptz,
  confirmation_evidence text,
  liquidated_by uuid references users(id),
  liquidated_at timestamptz,
  divergence_note text,
  notes text,
  check ((kind = 'estorno') = (reversal_of is not null))
);
create unique index payments_one_reversal_uq on payments (reversal_of) where reversal_of is not null;
create index payments_receivable_idx on payments (receivable_id);
create index payments_unit_paid_idx on payments (unit_id, paid_at);

create table cash_movements (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  cash_session_id uuid not null references cash_sessions(id),
  kind text not null check (kind in ('recebimento','estorno','sangria','suprimento','despesa','ajuste')),
  method_id uuid references payment_methods(id),
  amount_cents integer not null check (amount_cents > 0),
  direction integer not null check (direction in (1,-1)),
  payment_id uuid unique references payments(id),
  description text,
  idempotency_key text unique,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);

create table payables (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  category_id uuid not null references financial_categories(id),
  description text not null,
  supplier text,
  amount_cents integer not null check (amount_cents > 0),
  due_date date not null,
  competence_date date,
  recurrence text check (recurrence in ('mensal','trimestral','anual')),
  recurrence_parent_id uuid references payables(id),
  installment_no integer,
  installment_total integer,
  status text not null default 'ativo' check (status in ('ativo','cancelado')),
  cancel_reason text,
  notes text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create unique index payables_recurrence_uq on payables (recurrence_parent_id, due_date) where recurrence_parent_id is not null;
create index payables_unit_due_idx on payables (unit_id, due_date);

create table payable_payments (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  payable_id uuid not null references payables(id),
  account_id uuid references financial_accounts(id),
  cash_session_id uuid references cash_sessions(id),
  kind text not null default 'pagamento' check (kind in ('pagamento','estorno')),
  reversal_of uuid references payable_payments(id),
  amount_cents integer not null check (amount_cents > 0),
  paid_at timestamptz not null default now(),
  idempotency_key text not null unique,
  evidence text,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  check ((kind = 'estorno') = (reversal_of is not null))
);
create unique index payable_payments_one_reversal_uq on payable_payments (reversal_of) where reversal_of is not null;

create table capital_entries (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  kind text not null check (kind in ('aporte','emprestimo')),
  amount_cents integer not null check (amount_cents > 0),
  entry_date date not null,
  account_id uuid references financial_accounts(id),
  description text,
  idempotency_key text unique,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table financial_goals (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  kind text not null check (kind in ('receita','resultado','reserva')),
  name text not null,
  target_cents integer not null check (target_cents >= 0),
  period_start date,
  period_end date,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table period_closures (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  version integer not null default 1,
  status text not null default 'fechado' check (status in ('fechado','reaberto')),
  snapshot jsonb not null,
  closed_by uuid not null references users(id),
  closed_at timestamptz not null default now(),
  unique (unit_id, period_start, version)
);

create table audit_logs (
  id bigserial primary key,
  unit_id uuid,
  user_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  note text,
  created_at timestamptz not null default now()
);
create index audit_logs_entity_idx on audit_logs (entity, entity_id);
create index audit_logs_created_idx on audit_logs (created_at desc);

create or replace function audit_logs_immutable() returns trigger as $$
begin
  raise exception 'audit_logs é imutável';
end;
$$ language plpgsql;
create trigger audit_logs_no_update before update or delete on audit_logs
  for each row execute function audit_logs_immutable();

create table automation_runs (
  id uuid primary key default gen_random_uuid(),
  automation_id text not null,
  unit_id uuid,
  idempotency_key text,
  status text not null check (status in ('sucesso','erro','ignorado')),
  trigger_event text,
  input jsonb,
  output jsonb,
  error text,
  created_at timestamptz not null default now()
);
create unique index automation_runs_idem_uq on automation_runs (automation_id, idempotency_key) where idempotency_key is not null and status = 'sucesso';

create table notifications (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  user_id uuid references users(id),
  kind text not null,
  severity text not null default 'info' check (severity in ('info','atencao','critico')),
  message text not null,
  ref_entity text,
  ref_id text,
  dedupe_key text unique,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

-- Visões de saldo: estados derivados, nunca digitados à mão
create view receivable_balances as
select r.id as receivable_id,
       r.unit_id,
       r.amount_due_cents,
       coalesce(sum(case when p.kind = 'recebimento' then p.amount_cents else -p.amount_cents end), 0)::bigint as registered_cents,
       coalesce(sum(case when p.status in ('confirmado','liquidado') then (case when p.kind = 'recebimento' then p.amount_cents else -p.amount_cents end) else 0 end), 0)::bigint as confirmed_cents,
       coalesce(sum(case when p.status = 'liquidado' then (case when p.kind = 'recebimento' then p.amount_cents else -p.amount_cents end) else 0 end), 0)::bigint as settled_cents
from receivables r
left join payments p on p.receivable_id = r.id
group by r.id;

create view payable_balances as
select b.id as payable_id,
       b.unit_id,
       b.amount_cents,
       coalesce(sum(case when pp.kind = 'pagamento' then pp.amount_cents else -pp.amount_cents end), 0)::bigint as paid_cents
from payables b
left join payable_payments pp on pp.payable_id = b.id
group by b.id;

-- Defesa em profundidade: sem políticas, papéis anon/authenticated não leem nada.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;
