# Decisões tomadas durante a construção

Você pediu que eu decidisse as dúvidas pelo critério que achasse melhor e relatasse depois. Abaixo está tudo o que decidi, com o motivo. Qualquer item pode ser mudado.

## Fluxo de trabalho e infraestrutura

| # | Decisão | Motivo |
|---|---|---|
| 1 | Construí **tudo localmente** (`C:\dev\marfim-studio-os`, fora do OneDrive) e **não criei nada** em Supabase, Vercel ou GitHub, nem comprei domínio. | Você disse que criaria as contas com um e-mail novo e depois subiríamos. O projeto Vercel vazio "marfim-studio-os", criado antes dessa decisão, continua na conta atual (sem deploy). |
| 2 | Não toquei nos projetos "MARFIM Studio" já existentes (Supabase/Vercel), que têm outro uso e dados reais. | Evitar misturar sistemas e arriscar dados. |
| 3 | Banco: **PostgreSQL**. Local usa PGlite (Postgres real em WebAssembly, em arquivo); produção usa `DATABASE_URL`. O SQL é o mesmo. | Permite testar tudo (inclusive restrições do banco) sem instalar nada e migrar para o Supabase sem reescrever. |
| 4 | Autenticação própria (senha com scrypt, sessão em cookie `HttpOnly`, TOTP para MFA) em vez de Supabase Auth. | Supabase Auth exigiria um projeto Supabase agora. A camada está isolada em `src/server/auth.ts` e pode ser trocada depois. |
| 5 | Acesso ao banco só pelo servidor, com autorização no servidor; RLS ativada em todas as tabelas **sem políticas** (nega tudo para os papéis públicos do Supabase). | Defesa em profundidade: mesmo com a chave pública do Supabase exposta, a API automática não lê nada. Resolve o risco R1 (Prisma × RLS) sem ORM. |
| 6 | Sem Prisma: SQL parametrizado em serviços tipados. | Menos dependências e controle total sobre transações e restrições. |
| 7 | Domínio provisório: quando existir, `*.vercel.app`; nada comprado. | Conforme sua instrução. |
| 8 | Rotinas diárias: rodam sozinhas na primeira abertura do dia por usuário financeiro **e** via `/api/cron/daily` (Vercel Cron, 09:00 UTC) protegida por `CRON_SECRET`. | Sem custo de fila/worker. Idempotentes: rodar duas vezes não duplica nada. |

## Regras financeiras

| # | Decisão |
|---|---|
| 9 | Dinheiro em **centavos inteiros**; datas em UTC com fuso America/Sao_Paulo fixo em UTC-3 (sem horário de verão desde 2019). |
| 10 | Receita operacional = atendimentos **concluídos** (por data de conclusão), líquida de desconto. **Não é dinheiro recebido.** |
| 11 | Pagamento tem 3 estágios: **registrado** (operador lançou) → **confirmado** (alguém conferiu, com evidência) → **liquidado** (conferido no extrato). Cada passo grava quem, quando e a evidência. Nada disso é apresentado como verificação bancária. |
| 12 | **Dinheiro nasce "confirmado"** (conferido na contagem do fechamento do caixa); Pix e cartão nascem "registrados". |
| 13 | Estorno é um **novo lançamento** ligado ao original (uma única vez, só proprietário). Herda a situação do original para não distorcer os totais. Nunca há exclusão de registro financeiro. |
| 14 | Taxas de Pix/cartão vêm da forma de pagamento (editável) e entram na DRE como "Taxas de meios de pagamento". Pagamentos antigos mantêm a taxa da época. |
| 15 | DRE: **competência**. Custos/despesas/impostos pela data de competência (ou vencimento). Pró-labore é despesa; **distribuição de lucros, aportes e empréstimos não são receita nem despesa** (aparecem à parte / só no caixa). |
| 16 | Fluxo de caixa: **regime de caixa**. Só entra o que foi confirmado (líquido de taxa); sangria/suprimento são movimentos internos e não entram. O que for projetado é rotulado **estimativa**, em linha tracejada. |
| 17 | Saldo das contas = saldo inicial + recebimentos confirmados líquidos + aportes − contas pagas. Cada forma de pagamento aponta para a conta de destino. |
| 18 | Ocupação = minutos de atendimento ÷ minutos disponíveis (horário de funcionamento × cadeiras, **até agora**). Sem horário cadastrado, o indicador mostra "—" e um aviso (não inventa número). Horas reservadas aparecem à parte. |
| 19 | Ticket médio considera só atendimentos com valor (cortesias ficam fora). |
| 20 | Meta de reserva compara com o **saldo total das contas** (definição simples e explícita). |
| 21 | Fechamento mensal **bloqueia** com: período não terminado, atendimento sem cobrança, agendamento vencido em aberto, pagamento sem conferência ou caixa aberto. **Só avisa** sobre pagamentos confirmados sem liquidação e saldos em aberto. Fechado = lançamentos datados no período são recusados; só o proprietário reabre (com motivo) e o histórico fica versionado. |

## Operação

| # | Decisão |
|---|---|
| 22 | Conflito de agenda é barrado **no banco** (restrição de exclusão por intervalo de tempo, para cadeira e para profissional), além da validação na tela; duas pessoas tentando o mesmo horário: só uma vence. |
| 23 | Ao concluir o atendimento, o horário real termina agora e libera o restante da janela reservada. |
| 24 | Agendar no passado: só com permissão e dentro da janela configurável (padrão 7 dias). |
| 25 | Se o profissional tem escala cadastrada, só agenda dentro dela; sem escala, não há restrição. |
| 26 | Desconto: por padrão só o proprietário. Configurável: limite % para gerente/permissão individual. Sempre com motivo e responsável. |
| 27 | Barbeiro só vê/opera o próprio; registrar pagamento é permissão **individual** concedida pelo proprietário (padrão: desligada). |
| 28 | MFA (TOTP) obrigatório para proprietário e gerente **em produção** (em desenvolvimento fica desligado para facilitar testes; configurável). Sem QR code: o aplicativo recebe a chave digitada. |
| 29 | Login: 5 erros bloqueiam 15 minutos e avisam o proprietário. O mesmo vale para códigos MFA errados. Descobri e corrigi um bug que fazia o contador de erros ser desfeito; está coberto por teste. |
| 30 | Cadastro de clientes mínimo: nome e telefone; e-mail, CPF e nascimento opcionais e visíveis só a quem pode editar dados sensíveis (LGPD: coleta com finalidade). |
| 31 | Exportação em CSV (com proteção contra fórmulas de planilha) e backup lógico em JSON, ambos auditados; só proprietário. |

## Configurável pelo proprietário (nada fixo no código)

Serviços (nome, categoria, duração, intervalo, cor, quem executa, preço **com vigência e histórico**, campos livres) · categorias · profissionais, vínculo (CLT/PJ/autônomo), escala · cadeiras · horário de funcionamento · formas de pagamento e taxas · contas financeiras e saldo inicial · plano de contas · limite de desconto · janela retroativa · política de não comparecimento · regime tributário · retenção de dados · exigência de MFA · usuários e permissões individuais.

## O que **não** foi feito (de propósito ou por falta de acesso)

- Nenhum deploy, domínio, repositório GitHub ou projeto Supabase novo (aguardando as contas novas).
- Sem e-mail/WhatsApp (dependem de serviço externo e custo; alertas ficam dentro do sistema).
- Fiscal e multiunidade seguem fora da interface. Comissões, estoque, tarefas e retornos entraram na V4 (ver `docs/V4.md`).
- Sem IA (a lógica financeira é determinística e testável).
- Restauração de backup do Supabase não pôde ser testada (não há projeto); o procedimento está em `OPERACAO.md`.
