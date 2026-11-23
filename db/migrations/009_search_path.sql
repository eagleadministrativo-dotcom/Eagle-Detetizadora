-- 009: fixa o search_path das funções de gatilho (recomendação de segurança do Supabase: evita resolver nomes em schemas inesperados).
alter function audit_logs_immutable() set search_path = public, pg_temp;
alter function row_changes_immutable() set search_path = public, pg_temp;
alter function marfim_row_audit() set search_path = public, pg_temp;
