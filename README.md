# 🦅 Eagle Detetizadora OS

Sistema de gestão interna para pest control (dedetização) baseado no MARFIM Studio OS.

## ✨ Funcionalidades

- **Autenticação** - Email + código de 6 dígitos
- **Clientes** - CRUD com histórico de serviços
- **Agenda** - Calendar view com retornos automáticos
- **Retornos** - Garantia, manutenção, outros
- **Orçamentos** - Com itens e impressão
- **Ordens de Serviço** - Ligadas a agendamentos
- **Financeiro** - Receitas, gastos, saldo
- **Equipe** - Perfis e permissões por módulo
- **Auditoria** - Trilha de todas as operações

## 🛠️ Stack

- **Frontend:** Next.js 16 App Router, React 19, TypeScript
- **Backend:** Next.js Server Actions, Node.js
- **Database:** PGlite (dev) ou Postgres/Supabase (prod)
- **CSS:** Single file, sem dependências
- **Auth:** Email + código

## 🚀 Setup Local

```bash
# Clone
git clone https://github.com/eagleadministrativo-dotcom/Eagle-Detetizadora.git
cd Eagle-Detetizadora

# Install
npm install

# Run migrations
npm run db:migrate

# Dev mode
npm run dev

# Ou demo com dados pré-carregados
npm run dev:demo
# → http://localhost:3000
# admin@demo.eagle.local / Demo@Eagle2026
```

## 📋 Perfis e Permissões

| Perfil | Acesso |
|--------|--------|
| Administrador | Tudo |
| Gerente | Operações + Financeiro |
| Vendedora/Gestora | Clientes, Agenda, Orçamentos, OS, Retornos, Financeiro (view), Gráficos |
| Vendedor | Clientes, Agenda, Retornos, Orçamentos, Gráficos |
| Técnico | Própria agenda, Retornos |
| Colaborador | Apenas módulos configurados |
| Pendente | Sem acesso até confirmação |

## 🔧 Variáveis de Ambiente

```
DATABASE_URL=postgresql://...
MAIL_HOST=smtp.gmail.com (opcional)
MAIL_PORT=587
MAIL_USER=...
MAIL_PASS=...
```

Ver `.env.example` para todas as variáveis.

## 📦 Deploy

Veja `DEPLOY.md` para instruções completas de deploy no Vercel + Supabase.

```bash
# Production build
npm run build

# Production server
npm start
```

## 🗂️ Estrutura

```
src/
├── app/                    # Next.js App Router
│   ├── (app)/             # Layout autenticado
│   ├── actions/           # Server actions
│   └── styles.css         # CSS único
├── server/
│   ├── services/          # Business logic
│   ├── db.ts              # Database connection
│   ├── permissions.ts     # Roles & modules
│   └── session.ts         # Auth middleware
├── components/            # React components
└── lib/                   # Utilities
```

## 📝 Commits Principais

- Reescrever permissions com módulos da Eagle
- Services para Retornos, Orçamentos, OS, Financeiro
- UI: Retornos, Orçamentos, Financeiro, OS
- Remover barbershop (MARFIM)
- Deploy documentation

## 🐛 Troubleshooting

**Erro de migração:**
```bash
rm -rf .data
npm run db:migrate
```

**Erro de build:**
```bash
npm run clean
npm install
npm run build
```

## 📞 Suporte

Funcionalidades externas ainda não integradas:
- Google Calendar
- NF-e
- WhatsApp Business
- Email (opcional)

## 📄 Licença

Código baseado em MARFIM Studio OS, adaptado para Eagle Detetizadora.
