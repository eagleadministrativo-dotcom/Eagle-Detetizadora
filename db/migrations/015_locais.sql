-- 015: o "local" interno de atendimento herdou o nome de cadeira da barbearia.
update chairs set name = regexp_replace(name, '^Cadeira', 'Local') where name ~ '^Cadeira';
