-- 021: histórico de serviços já prestados (planilhas de vendas antigas).
-- Fica separado da agenda/OS: não gera retorno, aviso, comissão nem conflito de horário. Só consulta.
create table if not exists service_history (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  customer_id uuid not null references customers(id) on delete restrict,
  service_date date not null,
  sale_date date,
  description text,
  amount_cents integer check (amount_cents >= 0),
  amount_note text,
  payment_kind text,
  payment_detail text,
  service_address text,
  customer_status text,
  report text,
  warranty text,
  return_note text,
  seller text,
  notes text,
  follow_up text,
  source text not null default 'planilha',
  source_ref text,
  created_at timestamptz not null default now()
);
create index if not exists service_history_unit_date_idx on service_history (unit_id, service_date desc);
create index if not exists service_history_customer_idx on service_history (customer_id, service_date desc);
-- a mesma linha da planilha não entra duas vezes
create unique index if not exists service_history_source_uq on service_history (unit_id, source, source_ref) where source_ref is not null;
do $$ begin
  execute 'drop trigger if exists zz_row_audit on service_history';
  execute 'create trigger zz_row_audit after insert or update or delete on service_history for each row execute function marfim_row_audit()';
  execute 'alter table public.service_history enable row level security';
end $$;
