-- Só Supabase (usa pg_cron, pgcrypto e Vault; não roda no banco local).
-- Troca automática do segredo das rotinas no dia 1 de cada mês, às 04:07 (UTC).
-- O valor novo é gerado dentro do banco e nunca passa por código, variável de ambiente ou conversa.
-- As duas rotinas (marfim-lembretes, marfim-diaria) leem o cofre a cada execução, e o app relê o cofre
-- quando recebe um valor diferente do que tem em memória (src/server/cron.ts): a troca não causa falha.
select cron.schedule(
  'marfim-rotacao-segredo',
  '7 4 1 * *',
  $$select vault.update_secret((select id from vault.secrets where name = 'marfim_cron'), encode(extensions.gen_random_bytes(32), 'hex'))$$
);
