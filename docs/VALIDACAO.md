# Validação do MVP

Resultado em 22/11/2026: **58 testes automatizados passando**, `tsc` e `eslint` sem erros, build de produção concluído. Navegação real verificada no navegador (desktop e celular) com a base de demonstração.

## Critérios de aceite do MVP (especificação V1.1 §11)

| # | Critério | Situação | Evidência |
|---|---|---|---|
| 1 | Dois operadores não reservam a mesma cadeira | **Atendido** | `flow.test`: duas tentativas simultâneas no mesmo horário → só uma vence; restrição de exclusão no banco (`schema.test`, sobreposição parcial incluída) |
| 2 | Atendimento termina sem pagamento imediato | **Atendido** | `flow.test`: cobrança pendente, criada uma única vez |
| 3 | Pagamentos parciais calculados corretamente | **Atendido** | `flow.test` (8.000 de 10.000: registrado/conferido/liquidado separados), `reports.test` (DRE e indicadores com valores exatos) |
| 4 | Lançamento não duplica por repetição de evento | **Atendido** | chave de idempotência em pagamento, conta paga, aporte; cobrança única por atendimento; recorrência e alertas idempotentes (`flow`, `reports`, `consistency`) |
| 5 | Caixa e contas a receber consistentes | **Atendido** | `consistency.test` (simulação de ~30 dias): cobranças = atendimentos, saldos = pagamentos, cada pagamento em caixa tem movimento, fechamentos fecham a conta |
| 6 | DRE e fluxo de caixa separados | **Atendido** | telas distintas (competência × caixa); fluxo realizado fecha com o saldo atual (`consistency.test`) |
| 7 | Histórico financeiro auditável | **Atendido** | `audit_logs` imutável (gatilho), estorno/cancelamento em vez de exclusão, trilha cobrindo o fluxo completo (`consistency.test`) |
| 8 | Barbeiro não acessa o financeiro privado | **Atendido** | matriz testada (`auth.test`), indicadores financeiros ocultos (`reports.test`), e verificado por HTTP no sistema rodando: telas financeiras/administrativas → "acesso restrito", APIs → 403, detalhamento financeiro → 404 |
| 9 | Dashboard coerente com os registros | **Atendido** | `consistency.test`: DRE = dashboard = soma do detalhamento = série diária |
| 10 | Dados exportáveis | **Atendido** | CSV por conjunto e backup JSON (`reports.test`, rotas verificadas) |
| 11 | Backup restaurável | **Atendido para o backup lógico; pendente para o do Supabase** | `consistency.test`: exporta → restaura em banco vazio → todos os indicadores idênticos. Restauração do backup automático do Supabase só poderá ser testada com o projeto criado |
| 12 | Alertas sem notificação duplicada | **Atendido** | chave de deduplicação única; testes de A08 e rotina diária |
| 13 | Fluxos essenciais no celular | **Atendido com ressalva** | agenda em lista, formulários e navegação inferior verificados em 375 px. Falta teste em aparelhos reais |
| 14 | Proprietário aprova simulação completa | **Pendente (sua parte)** | rode `npm run demo` e `npm run dev:demo` e percorra o dia: agendar → atender → receber → conferir → fechar caixa → DRE |

## Simulações exigidas pela V1.2 §14

| Simulação | Coberta |
|---|---|
| Dia, semana e mês de atendimentos | sim (demo de 30 dias + `consistency.test`) |
| Cancelados e clientes ausentes | sim (`flow.test`, regras de ausência e política de taxa) |
| Pagamentos parciais, duplicados e estornos | sim |
| Despesas recorrentes e parceladas | sim (`reports.test`) |
| Divergência de caixa | sim (demo com diferenças justificadas) |
| Mudança de preços | sim (preço antigo preservado) |
| Fechamento mensal e trava de período | sim |
| Usuários sem permissão | sim |
| Tentativas concorrentes de agendamento | sim |
| Falhas de conexão | **não** (depende do ambiente de produção) |

## Bugs encontrados e corrigidos durante a validação

1. **Bloqueio de login ineficaz** (o contador de erros era desfeito pela transação): corrigido; MFA também ganhou limite de tentativas. Teste de regressão incluído.
2. Estorno de pagamento ainda não conferido deixava o "confirmado" negativo: corrigido (o estorno herda a situação do original).
3. Lançamento retroativo falhava quando o preço foi cadastrado depois da data: usa o preço atual.
4. Editar uma forma de pagamento/serviço zerava a ordem de exibição: corrigido.
5. Formulários perdiam os dados após um erro de validação (agendamento): agora são preservados.
6. Item do menu "Resumo" ficava ativo junto com subpáginas; sidebar clara no modo escuro; barra fixa sobreposta à navegação no celular: corrigidos.

## Metas de desempenho (medidas na base de demonstração, ~1.000 registros)

Meta: telas principais < 800 ms no servidor. Medido: 25–70 ms (produção, máquina local). Em produção (Supabase em São Paulo + Vercel) a latência de rede soma ~50–150 ms; **revalidar na homologação** com o volume real.

## O que ainda precisa de você ou do ambiente real

- Conferir o adaptador de produção (`pg`) contra o Supabase e testar a restauração do backup do Supabase.
- Teste em celulares reais e auditoria de acessibilidade (navegação por teclado foi respeitada nos formulários, mas não há auditoria formal).
- Cadastrar dados reais (serviços, preços, equipe, taxas) e validar a DRE com o contador (plano de contas e regime tributário).
- Aprovar a simulação (item 14).
