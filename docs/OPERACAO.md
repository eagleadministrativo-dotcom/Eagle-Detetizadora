# Operação, publicação e backup

## 1. Publicar (quando as contas novas estiverem prontas)

Custo esperado: dentro dos planos gratuitos para uma unidade; **confirme limites atuais antes de contratar** (backup diário e restauração a um ponto no tempo podem exigir plano pago no Supabase).

1. **GitHub** (conta da empresa): criar repositório privado e enviar o código (`git init`, `git remote add`, `git push`).
2. **Supabase** (conta da empresa): criar projeto na região `sa-east-1` (São Paulo). Em *Project Settings → Database*, copiar a *connection string* (use a de **pooler/transaction** para a Vercel).
3. **Migrar o banco:**
   ```powershell
   $env:DATABASE_URL = "postgresql://postgres.xxxx:SENHA@aws-0-sa-east-1.pooler.supabase.com:6543/postgres"
   npm run db:migrate
   ```
   (também roda sozinho na primeira requisição do app; o comando permite conferir antes).
4. **Vercel:** importar o repositório (framework Next.js) e definir as variáveis:
   - `DATABASE_URL` — obrigatória (sem ela o app recusa iniciar em produção, para nunca gravar em disco efêmero);
   - `CRON_SECRET` — texto longo e aleatório (ativa a rotina diária protegida em `/api/cron/daily`, agendada em `vercel.json`).
5. Abrir o endereço `*.vercel.app` → tela **Primeira configuração** cria a empresa e o proprietário → ativar MFA no primeiro login.
6. Cadastrar serviços/preços, equipe, cadeiras, horário de funcionamento, formas de pagamento (taxas) e contas.
7. Domínio próprio: quando comprado, adicionar em *Vercel → Domains* (só com sua autorização).

> Nunca coloque senhas, chaves ou `DATABASE_URL` no código ou no repositório. Use somente variáveis de ambiente da Vercel.

## 2. Backup e restauração

| Camada | Backup | Restauração |
|---|---|---|
| Banco (Supabase) | backup automático do plano (ver prazo/retenção do plano contratado) | painel do Supabase (restauração a ponto no tempo, se o plano permitir) |
| Lógico (sempre disponível) | *Administração → Dados e backup → Baixar backup lógico* (JSON, sem senhas) | ver abaixo |
| Planilhas | mesma tela (CSV de atendimentos, pagamentos, contas, clientes, auditoria) | só leitura/conferência |
| Código | repositório GitHub | `git clone` |

**Teste de restauração (faça antes de operar e a cada 6 meses):** criar um projeto Supabase de teste → `npm run db:migrate` apontando para ele → carregar o backup lógico (cada chave de `data` é uma tabela; inserir na ordem do arquivo `db/migrations/001_core.sql`) → abrir o sistema e conferir DRE, saldos e fechamentos do último mês contra os números originais.
*Esta restauração não foi executada neste ambiente (sem projeto Supabase).*

## 3. Rotinas automáticas

Rodam uma vez por dia (idempotentes): contas recorrentes (A07), alertas de vencimento (A08), projeção de caixa negativo (A10), metas (A11), reserva no fim do mês (A12), queda de margem aos domingos (A13), resumo do dia anterior (A14). Histórico em `automation_runs`. A15 (validar fechamento) roda quando o proprietário abre *Fechamento mensal*.

## 4. Segurança em produção — checklist

- [ ] `DATABASE_URL` e `CRON_SECRET` só na Vercel.
- [ ] MFA ativo para proprietário e gerente (padrão em produção).
- [ ] Senhas iniciais trocadas em *Minha conta*.
- [ ] Revisar *Administração → Usuários e permissões* (mínimo necessário).
- [ ] Conferir `npm audit` antes de cada atualização de dependências.
- [ ] Em incidente (acesso indevido): desativar o usuário, redefinir senhas (encerra sessões), exportar auditoria, trocar `DATABASE_URL`/senha do banco no Supabase.

## 5. Retenção e privacidade (LGPD)

Dados de clientes são opcionais além de nome/telefone. Defina o prazo de retenção em *Configurações* com orientação contábil/jurídica. Pedidos de correção/remoção de titulares: editar/desativar o cliente (o histórico financeiro permanece anonimizável por exigência legal de guarda dos registros contábeis).
