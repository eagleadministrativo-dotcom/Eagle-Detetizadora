-- 014: sem verificação em duas etapas. O e-mail é confirmado por código uma única vez (primeiro acesso);
-- depois disso o login fica lembrado no aparelho até a pessoa sair.

alter table users add column if not exists email_verified_at timestamptz;
-- quem já tem conta já confirmou o e-mail (convite, link da senha provisória ou "esqueci a senha")
update users set email_verified_at = now() where email_verified_at is null;

alter table email_codes drop constraint if exists email_codes_purpose_check;
alter table email_codes add constraint email_codes_purpose_check check (purpose in ('cadastro', 'senha', 'login'));

update unit_settings set mfa_required = false;
alter table unit_settings alter column mfa_required set default false;
update users set mfa_enabled = false, mfa_secret = null;
delete from mfa_recovery_codes;
delete from sessions where not mfa_verified;
