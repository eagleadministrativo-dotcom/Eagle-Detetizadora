-- Lista de compras. Ao marcar como comprado, cada parcela vira uma conta a pagar com competência no mês da fatura.
-- Reversão: drop table purchase_items; delete from schema_migrations where name='006_compras.sql';
create table purchase_items (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  name text not null,
  notes text,
  quantity integer not null default 1 check (quantity > 0),
  total_cents integer not null check (total_cents > 0),
  payment text not null default 'avista' check (payment in ('avista','credito')),
  installments integer not null default 1 check (installments between 1 and 24),
  first_due date,
  category_id uuid references financial_categories(id),
  priority text not null default 'normal' check (priority in ('baixa','normal','alta')),
  status text not null default 'pendente' check (status in ('pendente','comprado','cancelado')),
  payable_ids uuid[] not null default '{}',
  bought_at timestamptz,
  bought_by uuid references users(id),
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (payment = 'credito' or installments = 1)
);
create index purchase_items_unit_idx on purchase_items (unit_id, status, created_at desc);
alter table purchase_items enable row level security;
