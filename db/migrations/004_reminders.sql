-- Lembrete automático ao cliente (30 min antes do atendimento).
alter table appointments add column if not exists reminder_sent_at timestamptz;
alter table appointments add column if not exists reminder_channel text;
create index if not exists appointments_reminder_idx on appointments (starts_at) where status = 'agendado' and reminder_sent_at is null;
