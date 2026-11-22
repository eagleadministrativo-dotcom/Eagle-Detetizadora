-- Notificações push (PWA): um registro por aparelho/navegador inscrito.
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user on push_subscriptions(user_id);
alter table push_subscriptions enable row level security;

-- Marca quando o aviso já foi enviado por push (evita reenvio e disparo em massa do histórico).
alter table notifications add column pushed_at timestamptz;
update notifications set pushed_at = now();
