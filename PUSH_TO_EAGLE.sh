#!/bin/bash

echo "=== Transferir código para eagleadministrativo-dotcom ==="
echo ""
echo "⚠️  Pré-requisito: Você já deve ter criado o repo em:"
echo "   https://github.com/eagleadministrativo-dotcom/Eagle-Detetizadora"
echo ""
echo "Pressione ENTER para continuar..."
read

echo ""
echo "1. Commit do README"
git add README.md
git commit -m "Adicionar README

- Funcionalidades principais
- Stack do projeto
- Instruções de setup e deploy
Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"

echo ""
echo "2. Atualizar remoto para Eagle"
git remote set-url origin https://github.com/eagleadministrativo-dotcom/Eagle-Detetizadora.git

echo ""
echo "3. Push para eagleadministrativo-dotcom"
git push -u origin main --force

echo ""
echo "✅ Código transferido para: https://github.com/eagleadministrativo-dotcom/Eagle-Detetizadora"
echo ""
echo "Próximo passo: Deploy no Vercel"
echo "→ https://vercel.com/new"
echo "→ Import from GitHub"
echo "→ Selecione: eagleadministrativo-dotcom/Eagle-Detetizadora"
echo "→ Configure variáveis de ambiente"
echo "→ Deploy!"
