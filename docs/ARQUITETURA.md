# Arquitetura

## Visão geral

```
Navegador ──HTTPS──> Next.js (App Router, Server Components + Server Actions)
                         │  sessão (cookie HttpOnly) → permissões → serviço de domínio
                         ▼
                 src/server/services/*   regras de negócio, transações, auditoria
                         │  SQL parametrizado
                         ▼
                 PostgreSQL  (produção: Supabase via DATABASE_URL · local: PGlite em arquivo)
```

- **Sem API pública separada:** telas e ações rodam no servidor; o navegador nunca fala com o banco.
- **Autorização sempre no servidor** (`need(ctx, permissão)` em cada operação). Esconder um botão nunca é a única proteção.
- **Toda escrita é transacional** e deixa registro em `audit_logs` (imutável: gatilho do banco recusa UPDATE/DELETE).
- **Valores monetários** em centavos inteiros; **datas** em UTC, exibidas em America/Sao_Paulo.

## Camadas

| Camada | Onde | Responsabilidade |
|---|---|---|
| Esquema | `db/migrations/*.sql` | Tabelas, chaves, restrições (conflito de agenda, unicidade de pagamento, 1 caixa aberto, 1 estorno por pagamento), visões de saldo, RLS |
| Banco | `src/server/db.ts` | Conexão (PGlite/pg), transações, migrações automáticas |
| Segurança | `src/server/auth.ts`, `permissions.ts`, `session.ts` | Senha (scrypt), sessão, TOTP, bloqueio, matriz de permissões |
| Domínio | `src/server/services/` | Agenda, atendimento, pagamentos, caixa, financeiro, relatórios, fechamento, automações |
| Telas | `src/app/` | Páginas e ações (formulários com `<form action>`; confirmações sem JavaScript via `<details>`) |

## Integridade financeira (como é garantida)

| Risco | Proteção |
|---|---|
| Pagamento duplicado por repetição/duplo clique | `idempotency_key` único, gerado ao renderizar o formulário; reenviar devolve o mesmo registro |
| Cobrança duplicada | `receivables.attendance_id` único + chave de automação A03 |
| Conflito de agenda | restrição de exclusão (`EXCLUDE USING gist`) por cadeira e por profissional |
| Dois caixas abertos | índice único parcial |
| Estornar duas vezes | índice único parcial em `reversal_of` |
| Receber mais que o devido | verificação sob bloqueio de linha (`FOR UPDATE`) + visão de saldos |
| Alteração em mês fechado | `assertPeriodOpen` em pagamentos, contas e aportes |
| Exclusão silenciosa | não existe exclusão de registro financeiro; só estorno/cancelamento com motivo |
| Indicador sem origem | cada indicador traz definição, fórmula, origem, período, exclusões e a lista de registros |

## Preparado para crescer

Todas as tabelas operacionais têm `unit_id`; usuários têm papel **por unidade** (`user_units`); organização → unidades já existe. Multiunidade exige principalmente interface (seletor de unidade, consolidação) — não reconstrução do modelo.

## Como trocar peças depois

- **Supabase Auth:** substituir `src/server/auth.ts` (mantendo `getSession`) e remover `users.password_hash`.
- **E-mail/WhatsApp:** `notifications` já centraliza os alertas; um envio externo é um consumidor novo.
- **IA (futuro):** deve apenas ler indicadores e explicá-los; as regras de cálculo continuam determinísticas.

## Limites conhecidos

- O adaptador `pg` (produção) foi escrito mas **não foi exercitado contra um PostgreSQL real** neste ambiente (usei PGlite). As migrações e o SQL são os mesmos testados; o primeiro teste em produção deve ser um deploy de homologação.
- Sem funcionamento offline.
- Rotinas diárias dependem de alguém abrir o sistema ou do Cron configurado.
