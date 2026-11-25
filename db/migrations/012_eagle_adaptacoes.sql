-- 012: Eagle Detetizadora — módulos, retornos, orçamentos, OS, movimentações financeiras e dados da empresa.

-- Módulos liberáveis: clientes, agendamentos, retornos, orcamentos_os, graficos, financeiro.
alter table access_profiles add column if not exists modules text[] default '{}';
alter table user_invites add column if not exists modules text[] default '{}';

-- Agenda: quem não pode ter dois atendimentos ao mesmo tempo é o técnico. O "local" interno (antiga cadeira) não bloqueia.
alter table appointments drop constraint if exists appointments_chair_no_overlap;
alter table appointments add column if not exists service_address text;

alter table customers add column if not exists address text;
create index if not exists customers_unit_phone_idx on customers (unit_id, phone);

alter table unit_settings
  add column if not exists company_name text,
  add column if not exists company_cnpj text,
  add column if not exists company_phone text,
  add column if not exists company_email text,
  add column if not exists company_address text,
  add column if not exists company_logo text,
  add column if not exists revenue_goal_cents integer check (revenue_goal_cents >= 0);

alter table services add column if not exists warranty_days integer not null default 0 check (warranty_days between 0 and 1095);

-- Retornos: garantia, manutenção periódica e outros, ligados ao atendimento de origem e ao novo agendamento.
create table if not exists service_returns (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  customer_id uuid not null references customers(id) on delete restrict,
  origin_appointment_id uuid references appointments(id) on delete set null,
  staff_id uuid references staff(id) on delete set null,
  kind text not null check (kind in ('garantia','manutencao','outro')),
  due_date date not null,
  status text not null default 'pendente' check (status in ('pendente','agendado','concluido','cancelado')),
  appointment_id uuid unique references appointments(id) on delete set null,
  notes text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists service_returns_unit_due_idx on service_returns (unit_id, status, due_date);
-- o mesmo atendimento não gera dois retornos do mesmo tipo
create unique index if not exists service_returns_origin_kind_uq on service_returns (origin_appointment_id, kind) where origin_appointment_id is not null and status <> 'cancelado';

-- Orçamentos
create table if not exists quotes (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  number integer not null,
  customer_id uuid not null references customers(id) on delete restrict,
  service_address text,
  issue_date date not null default current_date,
  valid_until date,
  status text not null default 'rascunho' check (status in ('rascunho','enviado','aprovado','recusado')),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  payment_terms text,
  conditions text,
  notes text,
  appointment_id uuid references appointments(id) on delete set null,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (unit_id, number)
);
create table if not exists quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  service_id uuid references services(id) on delete set null,
  description text not null,
  quantity numeric(10,2) not null default 1 check (quantity > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  sort_order integer not null default 0
);

-- Ordens de serviço: no máximo uma por agendamento.
create table if not exists service_orders (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  number integer not null,
  appointment_id uuid not null unique references appointments(id) on delete restrict,
  quote_id uuid references quotes(id) on delete set null,
  status text not null default 'aberta' check (status in ('aberta','executada','cancelada')),
  pests text,
  products_used text,
  areas text,
  payment_method text,
  payment_status text not null default 'pendente' check (payment_status in ('pendente','pago','parcial')),
  notes text,
  customer_confirmed boolean not null default false,
  technician_confirmed boolean not null default false,
  warranty_days integer check (warranty_days between 0 and 1095),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (unit_id, number)
);

-- Movimentações lançadas à mão. Recebimentos dos atendimentos ficam em payments e NUNCA são copiados para cá.
create table if not exists finance_entries (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  kind text not null check (kind in ('receita','gasto')),
  category text not null,
  description text not null,
  amount_cents integer not null check (amount_cents > 0),
  entry_date date not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists finance_entries_unit_date_idx on finance_entries (unit_id, entry_date);
