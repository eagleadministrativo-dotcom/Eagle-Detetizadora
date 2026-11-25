-- Adaptações para Eagle Detetizadora
-- Adiciona tabelas para orçamentos, ordens de serviço, retornos e perfis de acesso

-- Tabela de perfis de acesso
create table if not exists access_profiles (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete cascade,
  name text not null,
  base_role text not null,
  permissions text[] not null default '{}',
  updated_at timestamptz not null default now(),
  unique (unit_id, name)
);

-- Tabela de orçamentos
create table if not exists quotations (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  customer_id uuid not null references customers(id) on delete restrict,
  number text not null,
  issued_at date not null default now()::date,
  validity_days integer not null default 30,
  total_cents integer not null check (total_cents >= 0),
  status text not null check (status in ('rascunho','enviado','aceito','recusado','expirado')) default 'rascunho',
  notes text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (unit_id, number)
);

-- Items de orçamento
create table if not exists quotation_items (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references quotations(id) on delete cascade,
  service_id uuid not null references services(id) on delete restrict,
  quantity integer not null check (quantity > 0) default 1,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  discount_cents integer not null check (discount_cents >= 0) default 0,
  notes text
);

-- Tabela de ordens de serviço
create table if not exists service_orders (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  customer_id uuid not null references customers(id) on delete restrict,
  attendance_id uuid references attendances(id) on delete set null,
  quotation_id uuid references quotations(id) on delete set null,
  number text not null,
  issued_at date not null default now()::date,
  scheduled_at date,
  total_cents integer not null check (total_cents >= 0),
  status text not null check (status in ('pendente','confirmada','completa','cancelada')) default 'pendente',
  service_address text,
  notes text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (unit_id, number)
);

-- Items de ordem de serviço
create table if not exists service_order_items (
  id uuid primary key default gen_random_uuid(),
  service_order_id uuid not null references service_orders(id) on delete cascade,
  service_id uuid not null references services(id) on delete restrict,
  quantity integer not null check (quantity > 0) default 1,
  unit_price_cents integer not null check (unit_price_cents >= 0)
);

-- Estender attendance para incluir informações específicas de serviço de dedetização
alter table if exists attendances add column if not exists service_address text;
alter table if exists attendances add column if not exists warranty_months integer;
alter table if exists attendances add column if not exists next_service_date date;

-- Estender services para campos específicos de dedetização
alter table if exists services add column if not exists warranty_months integer default 0;
alter table if exists services add column if not exists requires_follow_up boolean default false;

-- Adicionar índices para performance
create index if not exists quotations_unit_customer_idx on quotations (unit_id, customer_id);
create index if not exists quotations_number_idx on quotations (unit_id, number);
create index if not exists service_orders_unit_customer_idx on service_orders (unit_id, customer_id);
create index if not exists service_orders_number_idx on service_orders (unit_id, number);
