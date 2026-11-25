-- 013: as tabelas criadas na 012 entram na trilha do banco e ficam com RLS ligado, como todas as outras.
do $$
declare t text;
begin
  foreach t in array array['service_returns', 'quotes', 'quote_items', 'service_orders', 'finance_entries'] loop
    execute format('drop trigger if exists zz_row_audit on %I', t);
    execute format('create trigger zz_row_audit after insert or update or delete on %I for each row execute function marfim_row_audit()', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
