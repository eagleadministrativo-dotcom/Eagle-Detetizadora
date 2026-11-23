-- Reverte 007_ops.sql. Apaga a trilha do banco, os registros de rotinas/erros, limites, códigos de recuperação e dispensas do copiloto.
do $$
declare t text;
begin
  for t in select event_object_table from information_schema.triggers where trigger_name = 'zz_row_audit' and trigger_schema = 'public' group by 1 loop
    execute format('drop trigger if exists zz_row_audit on %I', t);
  end loop;
end $$;
drop function if exists marfim_row_audit();
drop table if exists row_changes;
drop function if exists row_changes_immutable();
drop table if exists job_runs, error_events, rate_limits, mfa_recovery_codes, copilot_dismissals;
delete from schema_migrations where name = '007_ops.sql';
