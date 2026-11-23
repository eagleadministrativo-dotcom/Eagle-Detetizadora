-- 010: cadastro por convite e códigos enviados por e-mail.
-- Só quem foi convidado (e-mail + perfil) consegue criar o próprio acesso; a senha é definida pela própria pessoa,
-- depois de confirmar um código de 6 dígitos recebido no e-mail. O mesmo mecanismo serve para "esqueci a senha".

create table if not exists user_invites (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete cascade,
  email text not null,
  full_name text not null,
  role text not null check (role in ('proprietario','gerente','barbeiro','contador')),
  staff_id uuid references staff(id) on delete set null,
  profile_id uuid references access_profiles(id) on delete set null,
  permissions text[],                       -- conjunto exato escolhido por quem convidou (null = padrão do perfil)
  invited_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_user_id uuid references users(id) on delete set null,
  revoked_at timestamptz
);
-- um convite em aberto por e-mail
create unique index if not exists user_invites_open_email on user_invites (lower(email)) where accepted_at is null and revoked_at is null;

-- Códigos de verificação. Nunca guardamos o código nem o identificador do fluxo em texto: só o hash.
create table if not exists email_codes (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('cadastro','senha')),
  email text not null,
  invite_id uuid references user_invites(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  flow_hash text not null unique,
  code_hash text,                           -- null: e-mail sem convite/conta (nada é enviado, mas a tela é a mesma)
  attempts int not null default 0,
  sends int not null default 0,
  last_sent_at timestamptz,
  expires_at timestamptz not null,
  verified_at timestamptz,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists email_codes_created on email_codes (created_at);

-- trilha do banco no convite (os códigos ficam fora: são técnicos e de curta duração)
drop trigger if exists zz_row_audit on user_invites;
create trigger zz_row_audit after insert or update or delete on user_invites for each row execute function marfim_row_audit();

alter table user_invites enable row level security;
alter table email_codes enable row level security;
