-- Opções cadastradas para montar o orçamento e a OS marcando, em vez de escrever:
-- formas de aplicação, produtos, "acompanha", agendamento, pagamento, prazo e validade.
create table if not exists doc_options (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  kind text not null check (kind in ('aplicacao','produto','acompanha','agendamento','pagamento','prazo','validade')),
  group_label text,                       -- produtos: "Controle de pragas urbanas", "Controle de roedores"
  text text not null check (length(trim(text)) > 0),
  sort_order int not null default 0,
  is_default boolean not null default false, -- já vem marcada no orçamento novo
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists doc_options_unit_kind_idx on doc_options (unit_id, kind, sort_order);

-- data e horário escolhidos na mini agenda do orçamento, e os serviços marcados (para agendar depois)
alter table quotes
  add column if not exists scheduled_date date,
  add column if not exists scheduled_time text,
  add column if not exists service_ids uuid[];

alter table unit_settings
  -- frase que abre a lista de produtos no orçamento
  add column if not exists quote_products_intro text default 'Obs.: os produtos serão usados de acordo com a avaliação técnica e o tipo de infestação. As descrições abaixo são de todos os produtos que usamos.',
  -- as opções iniciais (do modelo de orçamento da Eagle) entram uma única vez por unidade, pelo sistema
  add column if not exists doc_options_seeded boolean not null default false;

do $$ begin
  execute 'drop trigger if exists zz_row_audit on doc_options';
  execute 'create trigger zz_row_audit after insert or update or delete on doc_options for each row execute function marfim_row_audit()';
  execute 'alter table public.doc_options enable row level security';
end $$;
