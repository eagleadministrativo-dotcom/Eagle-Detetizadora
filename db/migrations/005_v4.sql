-- MARFIM V4: permissões, tarefas, eventos, produtos, comissões, retornos, séries, conquistas e preferências.
-- Somente aditiva. Reversão: db/rollback/005_v4_down.sql.

-- ───────── acesso e preferências ─────────
create table access_profiles (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  name text not null,
  base_role text not null check (base_role in ('gerente','barbeiro','contador')),
  permissions text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (unit_id, name)
);
alter table user_units add column profile_id uuid references access_profiles(id) on delete set null;

create table user_preferences (
  user_id uuid primary key references users(id) on delete cascade,
  theme text not null default 'auto' check (theme in ('auto','claro','escuro')),
  agenda_view text not null default 'dia' check (agenda_view in ('dia','semana','mes')),
  notify jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table unit_settings
  add column return_default_days integer not null default 25 check (return_default_days between 1 and 365),
  add column return_contact_gap_days integer not null default 7 check (return_contact_gap_days between 1 and 365),
  add column return_soon_days integer not null default 5 check (return_soon_days between 0 and 60),
  add column return_notify boolean not null default true,
  add column commission_trigger text not null default 'recebimento' check (commission_trigger in ('conclusao','recebimento')),
  add column record_min_volume integer not null default 10 check (record_min_volume > 0);

-- ───────── eventos ─────────
create table domain_events (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  type text not null,
  entity text not null,
  entity_id text not null,
  source text not null default 'sistema',
  actor_id uuid,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text unique,
  status text not null default 'pendente' check (status in ('pendente','processado','erro')),
  attempts integer not null default 0,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index domain_events_pending_idx on domain_events (created_at) where status = 'pendente';

-- ───────── notificações ─────────
alter table notifications add column url text;
create index notifications_user_idx on notifications (unit_id, user_id, created_at desc);
create table notification_reads (
  notification_id uuid not null references notifications(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);
-- preserva o que já estava lido
insert into notification_reads(notification_id, user_id)
  select n.id, uu.user_id from notifications n join user_units uu on uu.unit_id = n.unit_id where n.is_read on conflict do nothing;
create table notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references notifications(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  channel text not null default 'push',
  status text not null check (status in ('enviado','falha','expirado','sem_dispositivo','silenciado')),
  error text,
  created_at timestamptz not null default now()
);
create index notification_deliveries_idx on notification_deliveries (notification_id);

-- ───────── tarefas ─────────
create table task_recurrence_rules (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  template jsonb not null,
  rule jsonb not null,
  start_date date not null,
  end_date date,
  is_active boolean not null default true,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);
create table tasks (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  parent_id uuid references tasks(id) on delete restrict,
  recurrence_rule_id uuid references task_recurrence_rules(id),
  occurrence_date date,
  title text not null,
  description text,
  category text,
  priority text not null default 'normal' check (priority in ('baixa','normal','alta','urgente')),
  mode text not null default 'individual' check (mode in ('individual','coletiva')),
  status text not null default 'pendente' check (status in ('pendente','em_andamento','aguardando_aprovacao','concluida','cancelada')),
  requires_approval boolean not null default false,
  main_assignee_id uuid references users(id),
  due_at timestamptz,
  due_has_time boolean not null default false,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid references users(id),
  cancel_reason text
);
create unique index tasks_occurrence_uq on tasks (recurrence_rule_id, occurrence_date) where recurrence_rule_id is not null;
create index tasks_unit_status_idx on tasks (unit_id, status, due_at);
create table task_assignees (
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references users(id) on delete restrict,
  status text not null default 'pendente' check (status in ('pendente','em_andamento','concluida')),
  completed_at timestamptz,
  primary key (task_id, user_id)
);
create index task_assignees_user_idx on task_assignees (user_id);
create table task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references users(id),
  body text not null,
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create table task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references users(id),
  name text not null,
  mime text not null,
  size_bytes integer not null check (size_bytes between 1 and 2097152),
  content_b64 text not null,
  created_at timestamptz not null default now()
);

-- ───────── agenda recorrente ─────────
create table appointment_series (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  customer_id uuid not null references customers(id),
  staff_id uuid not null references staff(id),
  chair_id uuid references chairs(id),
  service_ids uuid[] not null,
  rule jsonb not null,
  time_hhmm text not null,
  start_date date not null,
  end_date date,
  max_occurrences integer check (max_occurrences between 1 and 104),
  is_active boolean not null default true,
  confirmed_note text not null,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);
alter table appointments add column series_id uuid references appointment_series(id);
create index appointments_series_idx on appointments (series_id) where series_id is not null;
create table appointment_series_occurrences (
  series_id uuid not null references appointment_series(id) on delete cascade,
  occurrence_date date not null,
  appointment_id uuid references appointments(id),
  status text not null check (status in ('criado','conflito')),
  error text,
  primary key (series_id, occurrence_date)
);

-- ───────── retornos ─────────
alter table customers
  add column contact_opt_out boolean not null default false,
  add column contact_channel text not null default 'whatsapp' check (contact_channel in ('whatsapp','telefone','email','nenhum')),
  add column contact_opt_out_at timestamptz,
  add column preferred_staff_id uuid references staff(id);
create table customer_return_rules (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  customer_id uuid not null references customers(id) on delete cascade,
  staff_id uuid references staff(id),
  rule jsonb,
  no_follow boolean not null default false,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now(),
  check (no_follow or rule is not null)
);
create unique index customer_return_rules_general_uq on customer_return_rules (customer_id) where staff_id is null;
create unique index customer_return_rules_staff_uq on customer_return_rules (customer_id, staff_id) where staff_id is not null;
create table customer_return_status (
  customer_id uuid primary key references customers(id) on delete cascade,
  unit_id uuid not null references units(id) on delete restrict,
  staff_id uuid references staff(id),
  last_attendance_id uuid references attendances(id),
  last_visit date not null,
  due_date date,
  rule_source text not null check (rule_source in ('cliente','profissional','padrao','sem_acompanhamento')),
  rule_label text not null,
  snoozed_until date,
  last_contact_at timestamptz,
  last_contact_outcome text,
  notified_due date,
  updated_at timestamptz not null default now()
);
create index customer_return_status_idx on customer_return_status (unit_id, staff_id, due_date);
create table customer_contact_attempts (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  customer_id uuid not null references customers(id) on delete cascade,
  user_id uuid not null references users(id),
  channel text not null,
  outcome text not null check (outcome in ('contatado','sem_resposta','recusou','agendou')),
  note text,
  idempotency_key text unique,
  created_at timestamptz not null default now()
);
create index customer_contact_attempts_idx on customer_contact_attempts (customer_id, created_at desc);

-- ───────── produtos ─────────
create table products (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  name text not null,
  sku text,
  description text,
  price_cents integer not null check (price_cents >= 0),
  track_stock boolean not null default true,
  stock_qty integer not null default 0 check (stock_qty >= 0),
  min_stock integer not null default 0 check (min_stock >= 0),
  commission_enabled boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index products_sku_uq on products (unit_id, lower(sku)) where sku is not null;
create table product_sales (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  attendance_id uuid unique references attendances(id),
  receivable_id uuid references receivables(id),
  customer_id uuid references customers(id),
  seller_staff_id uuid not null references staff(id),
  status text not null default 'aberta' check (status in ('aberta','concluida','cancelada')),
  gross_cents integer not null default 0 check (gross_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  total_cents integer not null default 0 check (total_cents >= 0),
  discount_reason text,
  discount_authorized_by uuid references users(id),
  idempotency_key text unique,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  check (discount_cents <= gross_cents)
);
create index product_sales_unit_idx on product_sales (unit_id, finished_at);
create table product_sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references product_sales(id) on delete cascade,
  product_id uuid not null references products(id),
  name_snapshot text not null,
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  gross_cents integer not null check (gross_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  returned_qty integer not null default 0 check (returned_qty >= 0),
  returned_cents integer not null default 0 check (returned_cents >= 0),
  check (returned_qty <= quantity),
  check (returned_cents <= total_cents),
  unique (sale_id, product_id)
);
create table product_returns (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  sale_item_id uuid not null references product_sale_items(id),
  quantity integer not null check (quantity > 0),
  amount_cents integer not null check (amount_cents >= 0),
  restock boolean not null,
  refund_payment_id uuid references payments(id),
  reason text not null,
  idempotency_key text not null unique,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);
create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  product_id uuid not null references products(id),
  kind text not null check (kind in ('entrada','venda','devolucao','ajuste','perda')),
  quantity integer not null check (quantity <> 0),
  balance_after integer not null,
  ref_entity text,
  ref_id text,
  note text,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);
create index stock_movements_idx on stock_movements (product_id, created_at desc);

-- ───────── comissões ─────────
create table commission_rules (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  scope text not null check (scope in ('servico','produto')),
  staff_id uuid references staff(id),
  service_id uuid references services(id),
  category_id uuid references service_categories(id),
  product_id uuid references products(id),
  pct_bps integer not null check (pct_bps between 0 and 10000),
  base text not null check (base in ('bruto','liquido')),
  valid_from date not null,
  valid_to date,
  note text,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from),
  check (num_nonnulls(service_id, category_id, product_id) <= 1),
  check ((scope = 'servico' and product_id is null) or (scope = 'produto' and service_id is null and category_id is null))
);
create index commission_rules_idx on commission_rules (unit_id, scope, valid_from desc);
create table commission_settlements (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  staff_id uuid not null references staff(id),
  period_start date not null,
  period_end date not null,
  entries_cents integer not null,
  adjustments_cents integer not null,
  total_cents integer not null check (total_cents > 0),
  payable_id uuid not null references payables(id),
  note text,
  evidence_name text,
  evidence_mime text,
  evidence_b64 text,
  approved_by uuid not null references users(id),
  approved_at timestamptz not null default now()
);
create table commission_entries (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  staff_id uuid not null references staff(id),
  kind text not null check (kind in ('servico','produto')),
  attendance_id uuid references attendances(id),
  attendance_item_id uuid references attendance_items(id),
  sale_item_id uuid references product_sale_items(id),
  receivable_id uuid not null references receivables(id),
  description text not null,
  gross_cents integer not null,
  discount_cents integer not null,
  base text not null,
  base_cents integer not null,
  pct_bps integer not null,
  amount_cents integer not null check (amount_cents >= 0),
  rule_id uuid not null references commission_rules(id),
  status text not null default 'gerada' check (status in ('gerada','aprovada','cancelada')),
  settlement_id uuid references commission_settlements(id),
  cancel_reason text,
  reference_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (num_nonnulls(attendance_item_id, sale_item_id) = 1),
  check ((status = 'aprovada') = (settlement_id is not null))
);
create unique index commission_entries_item_uq on commission_entries (attendance_item_id) where attendance_item_id is not null;
create unique index commission_entries_sale_uq on commission_entries (sale_item_id) where sale_item_id is not null;
create index commission_entries_staff_idx on commission_entries (unit_id, staff_id, reference_at desc);
create table commission_adjustments (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  staff_id uuid not null references staff(id),
  entry_id uuid references commission_entries(id),
  amount_cents integer not null check (amount_cents <> 0),
  reason text not null,
  settlement_id uuid references commission_settlements(id),
  dedupe_key text unique,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

-- ───────── desempenho ─────────
create table staff_goals (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  staff_id uuid not null references staff(id),
  metric text not null check (metric in ('atendimentos','receita_servicos','vendas_produtos','ticket_medio','tarefas')),
  month date not null,
  target integer not null check (target > 0),
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  unique (staff_id, metric, month)
);
create table achievement_definitions (
  metric text primary key,
  label text not null,
  unit text not null check (unit in ('brl','int')),
  period text not null check (period in ('dia','semana','mes')),
  sort_order integer not null
);
insert into achievement_definitions(metric,label,unit,period,sort_order) values
  ('faturamento_dia','Maior faturamento diário','brl','dia',1),
  ('faturamento_semana','Maior faturamento semanal','brl','semana',2),
  ('faturamento_mes','Maior faturamento mensal','brl','mes',3),
  ('atendimentos_dia','Mais atendimentos em um dia','int','dia',4),
  ('ticket_mes','Melhor ticket médio mensal','brl','mes',5),
  ('produtos_mes','Mais produtos vendidos no mês','int','mes',6);
create table employee_records (
  staff_id uuid not null references staff(id),
  metric text not null references achievement_definitions(metric),
  unit_id uuid not null references units(id) on delete restrict,
  value integer not null,
  period_start date not null,
  updated_at timestamptz not null default now(),
  primary key (staff_id, metric)
);
create table employee_achievements (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  staff_id uuid not null references staff(id),
  metric text not null references achievement_definitions(metric),
  period_start date not null,
  value integer not null,
  previous_value integer,
  status text not null default 'valida' check (status in ('valida','corrigida')),
  achieved_at timestamptz not null default now(),
  unique (staff_id, metric, period_start)
);

-- Segurança: RLS em todas as tabelas e visões executadas com o papel de quem consulta.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;
alter view receivable_balances set (security_invoker = true);
alter view payable_balances set (security_invoker = true);
