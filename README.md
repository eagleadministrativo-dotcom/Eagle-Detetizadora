# MARFIM Studio OS

Sistema web privado de gestão da barbearia MARFIM Studio: agenda, atendimentos, cobrança, caixa, financeiro (contas a pagar/receber, DRE gerencial, fluxo de caixa, metas, fechamento mensal), relatórios com indicadores rastreáveis, administração totalmente editável, auditoria e exportação de dados.

Stack: Next.js 16 (App Router) + TypeScript · PostgreSQL (migrações SQL em `db/migrations`) · sem serviços externos pagos.
Desenvolvimento e demonstração rodam com PostgreSQL embarcado (PGlite, em arquivo). Produção exige `DATABASE_URL` (ex.: Supabase).

## Rodar localmente

Requisitos: Node 22+ (testado em Node 24).

```powershell
npm install
npm run dev            # http://localhost:3000 — na 1ª vez abre a tela "Primeira configuração"
```

### Modo demonstração (dados fictícios)

```powershell
npm run demo           # cria .data/demo com 30 dias de movimento fictício (use -- --reset para recriar)
npm run dev:demo       # abre o sistema usando essa base
```

Logins de demonstração (senha `Demo@Marfim2026`): `dono@demo.marfim.local`, `gerente@demo.marfim.local`, `rafael@demo.marfim.local` (barbeiro), `diego@demo.marfim.local` (barbeiro), `contador@demo.marfim.local`.
**Nunca use a base de demonstração em produção.**

## Qualidade

```powershell
npm test               # 53 testes: regras financeiras, concorrência, permissões, segurança, simulação de um mês
npm run typecheck
npm run lint
npm run build
```

## Documentação (`docs/`)

| Arquivo | Conteúdo |
|---|---|
| `DECISOES-TOMADAS.md` | Decisões de produto/engenharia tomadas durante a construção (leia primeiro) |
| `ARQUITETURA.md` | Como o sistema está organizado e por quê |
| `VALIDACAO.md` | Critérios de aceite do MVP × evidências (testes e verificações) e o que ainda falta |
| `OPERACAO.md` | Publicar na Vercel + Supabase, variáveis, backup, restauração, rotinas, custos |

## Estrutura

```
db/migrations/        schema SQL versionado (aplicado automaticamente ao iniciar)
src/server/           regras de negócio (serviços), autenticação, permissões, banco
src/server/services/  agenda, atendimento, pagamentos, caixa, financeiro, relatórios, fechamento, automações
src/app/              telas (Next.js) e ações de formulário
src/lib/              dinheiro (centavos) e datas (America/Sao_Paulo)
scripts/              demo, migração
```
