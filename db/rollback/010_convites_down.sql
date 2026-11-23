-- Desfaz 010 (cadastro por convite). Os usuários já criados por convite continuam existindo.
drop table if exists email_codes;
drop table if exists user_invites;
delete from schema_migrations where name = '010_convites.sql';
