#!/bin/bash

echo "=== Setup GitHub para Eagle Detetizadora ==="
echo ""
echo "Passo 1: Fazer login com eagleadministrativo-dotcom"
gh auth logout
gh auth login

echo ""
echo "Passo 2: Criar repositório na conta correta"
gh repo create Eagle-Detetizadora --public --source=. --remote=eagle --push

echo ""
echo "Passo 3: Atualizar remoto local"
git remote set-url origin https://github.com/eagleadministrativo-dotcom/Eagle-Detetizadora.git

echo ""
echo "✅ Repositório criado em: https://github.com/eagleadministrativo-dotcom/Eagle-Detetizadora"
echo ""
echo "Próximo passo: Deploy no Vercel"
echo "→ Vá para https://vercel.com/dashboard"
echo "→ Import from GitHub → Eagle-Detetizadora"
echo "→ Add Environment Variables (DATABASE_URL, MAIL_*, etc)"
echo "→ Deploy!"
