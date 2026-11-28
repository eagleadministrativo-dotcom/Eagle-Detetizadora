-- 020: mais de um técnico no mesmo serviço; índices que faltavam nas consultas do dia a dia.

-- técnicos que acompanham o responsável (appointments.staff_id continua sendo o responsável)
create table if not exists appointment_helpers (
  appointment_id uuid not null references appointments(id) on delete cascade,
  staff_id uuid not null references staff(id),
  primary key (appointment_id, staff_id)
);
create index if not exists appointment_helpers_staff_idx on appointment_helpers (staff_id);
do $$ begin
  execute 'drop trigger if exists zz_row_audit on appointment_helpers';
  execute 'create trigger zz_row_audit after insert or update or delete on appointment_helpers for each row execute function marfim_row_audit()';
  execute 'alter table public.appointment_helpers enable row level security';
end $$;

-- desempenho: buscas por agendamento, cliente e técnico
create index if not exists appointment_services_appt_idx on appointment_services (appointment_id);
create index if not exists appointments_customer_idx on appointments (customer_id);
create index if not exists service_returns_customer_idx on service_returns (customer_id);
create index if not exists service_returns_staff_idx on service_returns (staff_id);
create index if not exists quotes_appointment_idx on quotes (appointment_id);
create index if not exists service_orders_quote_idx on service_orders (quote_id);
create index if not exists notifications_user_idx on notifications (user_id);
