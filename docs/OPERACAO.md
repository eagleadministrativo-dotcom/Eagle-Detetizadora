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
*A restauração do backup lógico é testada automaticamente a cada envio (`src/server/consistency.test.ts`: exporta, restaura em banco vazio e confere). O teste de restauração do backup do próprio Supabase depende do plano contratado e ainda não foi feito.*

## 3. Rotinas automáticas

Rodam uma vez por dia (idempotentes): contas recorrentes (A07), alertas de vencimento (A08), projeção de caixa negativo (A10), metas (A11), reserva no fim do mês (A12), queda de margem aos domingos (A13), resumo do dia anterior (A14). Histórico em `automation_runs`. A15 (validar fechamento) roda quando o proprietário abre *Fechamento mensal*.

**Agendamento:** pg_cron no Supabase chama `/api/cron/reminders` (a cada 5 min) e `/api/cron/daily` (9h UTC), com o segredo lido do Vault a cada execução. O segredo é trocado sozinho no dia 1 de cada mês (`db/supabase/rotacao-segredo.sql`).

**Saúde do sistema** (*Sistema → Saúde do sistema*): cada execução fica em `job_runs` (início, fim, resultado). Falha → aviso crítico ao proprietário (push no celular, se ativado). Rotina sem execução no prazo aparece como *Atrasada*. Erros do servidor ficam em `error_events` (sem dados de clientes). Registros com mais de 90 dias são apagados pela rotina diária.

**Trilha do banco** (`row_changes`): toda alteração e exclusão em tabela de negócio fica registrada pelo próprio banco, com antes/depois (sem colunas secretas). O app se conecta como `application_name = marfim-app` (pelo pooler do Supabase aparece como `Supavisor`, também tratado como app); outras origens (editor SQL do painel, `mgmt-api`, psql direto) são marcadas como *alteração direta* e aparece na Saúde do sistema. A trilha é imutável. Toda tabela nova precisa do trigger `zz_row_audit` (o teste `schema.test.ts` falha se faltar).

## 4. Segurança em produção — checklist

- [ ] `DATABASE_URL` e `CRON_SECRET` só na Vercel.
- [ ] MFA ativo para proprietário e gerente (*Configurações → Exigir verificação em duas etapas*). Depois de ativar, gerar os **códigos de recuperação** em *Minha conta* e guardá-los fora do celular.
- [ ] Limite de tentativas: 5 erros bloqueiam a conta por 15 min; 20 tentativas de login (ou 15 de código) por conexão em 15 min são barradas.
- [ ] Senhas iniciais trocadas em *Minha conta*.
- [ ] Revisar *Administração → Usuários e permissões* (mínimo necessário).
- [ ] Conferir `npm audit` antes de cada atualização de dependências.
- [ ] CI (GitHub Actions, `.github/workflows/ci.yml`) verde: varredura de segredos, tipos, lint, testes, build e ponta a ponta (Playwright, celular e computador, claro e escuro). Para impedir que a Vercel publique um commit com CI vermelho, ligar *Deployment Checks* no projeto da Vercel apontando para o job `verificar`.
- [ ] Em incidente (acesso indevido): desativar o usuário, redefinir senhas (encerra sessões), exportar auditoria, trocar `DATABASE_URL`/senha do banco no Supabase.

## 5. Retenção e privacidade (LGPD)

Dados de clientes são opcionais além de nome/telefone. Defina o prazo de retenção em *Configurações* com orientação contábil/jurídica. Pedidos de correção/remoção de titulares: editar/desativar o cliente (o histórico financeiro permanece anonimizável por exigência legal de guarda dos registros contábeis).

## Notificações no celular (push)

- O sistema é um app instalável (PWA): `manifest`, `public/sw.js` e ícones em `public/icons` (gerados por `node scripts/make-icons.mjs`).
- Cada pessoa ativa em **Minha conta → Notificações no celular**, em cada aparelho. Android/computador: Chrome ou Edge. iPhone: iOS 16.4+, só com o app instalado pelo Safari ("Adicionar à Tela de Início").
- Variáveis de ambiente (Vercel, Production): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (secreta), `VAPID_SUBJECT` (URL do site ou `mailto:`). Gere um par novo com `npx web-push generate-vapid-keys`. Trocar o par invalida as inscrições existentes (cada pessoa reativa).
- Quem recebe: proprietário e gerente da unidade. Os avisos são os da central de alertas (caixa, vencimentos, metas…).
- Envio: os avisos novos saem quando alguém usa o sistema (logo após a página carregar) e na rotina diária das 09:00. Plano Hobby da Vercel só permite cron diário, então com ninguém usando o sistema o aviso pode esperar até a rotina diária.
- Ao trocar de domínio, as pessoas precisam reinstalar o app e reativar as notificações (inscrição é por endereço).

## Testes de ponta a ponta

`npm run build` e depois `npm run e2e`: sobe o app com uma base de DEMONSTRAÇÃO nova (dados fictícios), entra como proprietário e percorre todas as telas do menu em 390 px e 1440 px, claro e escuro. Falha se houver rolagem lateral, elementos encavalados, número estourando o card, erro no console ou mais de um título por página.

`npm run e2e:visual`: compara cada tela com capturas locais (`e2e/__shots__`, fora do git). Use antes e depois de mexer no CSS: grave as referências com `npm run e2e:visual -- --update-snapshots` no código antigo e rode de novo no novo.

## Agenda ao vivo e offline

A agenda e a visão geral consultam `/api/agenda/versao` a cada 20–30 s (só com a tela visível) e recarregam quando outro aparelho muda algo. O service worker guarda **só** a última página da agenda e os arquivos do app, para abrir sem internet; nada de financeiro ou clientes. O cache é apagado ao sair da conta.

## Acesso: boas-vindas, cadastro por convite e "esqueci a senha"
- **Primeiro acesso no aparelho** abre `/bem-vindo` com **Entrar** e **Cadastrar**. Depois de entrar uma vez, o aparelho vai direto para o login.
- **Cadastrar** só funciona para quem foi convidado. Convide em *Usuários e permissões → Convidar pessoa* ou em *Equipe → profissional → E-mail para convidar*.
  A pessoa escolhe o perfil (Dono de barbearia = Proprietário; Barbeiro colaborador = Barbeiro; Administrador = Gerente ou Contador), informa o e-mail,
  recebe um código de 6 dígitos (vale 15 min, 5 tentativas, reenvio a cada 45 s) e cria a própria senha. O convite vale 14 dias.
- A tela responde igual para e-mails com e sem convite/conta: ninguém descobre quem tem acesso.
- **Senha errada 3 vezes** bloqueia novas tentativas por 10 minutos e a tela destaca *Esqueci a senha*. Redefinir pelo e-mail troca a senha,
  desbloqueia e encerra as sessões abertas; a verificação em duas etapas continua valendo. Código do autenticador: 5 erros, 15 minutos.

### E-mail (necessário em produção para convites e códigos)
Variáveis na Vercel (Production):
- `SMTP_URL` — servidor de envio. Ex. com Gmail: `smtps://SEU_EMAIL%40gmail.com:SENHA_DE_APP@smtp.gmail.com:465`
  (a senha de app é criada em myaccount.google.com → Segurança → Senhas de app; exige verificação em duas etapas na conta Google; o `@` do usuário vira `%40`).
- `MAIL_FROM` — remetente, ex.: `MARFIM Studio <SEU_EMAIL@gmail.com>`.
Sem `SMTP_URL`, o convite é criado mas o e-mail não sai (a tela mostra o link para passar à pessoa) e o envio de código mostra
"O envio de e-mails ainda não foi configurado". Em desenvolvimento e nos testes, `MAIL_OUTBOX_DIR` grava os e-mails como arquivos.
