# Deploy - Eagle Detetizadora OS

## Pré-requisitos

1. **Conta Vercel** - eagleadministrativo-dotcom
2. **Supabase Project** - conectado com GitHub
3. **DATABASE_URL** - do Supabase ou instância Postgres

## Etapas

### 1. Preparar o GitHub

- [ ] Transferir repo de `marfimstudioadm-alt/Eagle-Detetizadora` para `eagleadministrativo-dotcom/Eagle-Detetizadora`
- [ ] Ou criar novo repo em eagleadministrativo-dotcom

```bash
git remote set-url origin https://github.com/eagleadministrativo-dotcom/Eagle-Detetizadora.git
git push origin main
```

### 2. Variáveis de Ambiente

No Vercel, adicionar:

```
DATABASE_URL=postgresql://...
MAIL_HOST=smtp.gmail.com (opcional)
MAIL_PORT=587
MAIL_USER=...
MAIL_PASS=...
```

### 3. Deploy no Vercel

```bash
vercel --prod --env DATABASE_URL=...
```

Ou no dashboard do Vercel:
1. Conectar GitHub
2. Import repository
3. Add Environment Variables
4. Deploy

### 4. Supabase Integration

No Vercel, adicionar Supabase integration:
1. Settings → Integrations → Supabase
2. Conectar sua conta Supabase

## Testes Locais

```bash
npm install
npm run db:migrate
npm run dev:demo
# Acesso em http://localhost:3000
# Demo user: admin@demo.eagle.local
# Password: Demo@Eagle2026
```

## Checklist de Funcionalidades

- [ ] Login e autenticação funcionando
- [ ] Dashboard do Administrador
- [ ] CRUD de Clientes
- [ ] Agenda com retorno de agendamento
- [ ] Retornos (garantia, manutenção, outros)
- [ ] Orçamentos com PDF
- [ ] Ordens de Serviço
- [ ] Financeiro (receitas e gastos)
- [ ] Permissões por perfil
- [ ] Módulos liberáveis
- [ ] Mobile layout

## Troubleshooting

### Erro de migração
```bash
rm -rf .data
npm run db:migrate
```

### Erro de build
```bash
npm run clean
npm install
npm run build
```

## Dependências Externas Não Integradas

- Google Calendar (placeholder)
- NF-e (estrutura pronta, certificado não implementado)
- WhatsApp Business (estrutura preparada)
- Email SMTP (opcional)

