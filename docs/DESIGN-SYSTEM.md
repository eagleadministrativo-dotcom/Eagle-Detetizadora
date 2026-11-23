# Identidade visual e Design System

## Direção de arte escolhida
Combinação das três explorações, com papéis definidos:
- **Architectural Dark** (estrutura): menu lateral, login e cartão de saldo em grafite/carvão, com luz de bronze e grão discreto (concreto/couro). Dá profundidade e foco.
- **Olive Editorial** (leitura): títulos em serifa (Fraunces), superfícies de papel creme, olive para estados ativos, gráficos e blocos analíticos.
- **Burgundy Atelier** (ação): botão primário, cartão de resultado e blocos editoriais. Burgundy é usado com parcimônia para que continue sendo destaque.
Bronze/cognac aparecem só em linhas, reflexos e rótulos. Por quê: a combinação separa estrutura × leitura × ação, evita o visual "SaaS genérico" e mantém contraste alto onde há números.

## Paleta (tokens no início de `src/app/styles.css`)
Olive `#292D1E / #45482D / #686D47` · Burgundy `#351018 / #591D27 / #79353F` · Cream `#C9B798 / #E7D8BC / #F3EBDD / #F6F1E7` · Charcoal `#151615` · Graphite `#222321` · Warm Gray `#77766F` · Cognac `#9C6845` · Bronze `#A58D69`.
Tema claro (papel) e escuro (grafite) seguem a preferência do sistema. Os valores brutos ficam nos blocos `:root` e `:root[data-scheme="dark"]` de `styles.css` (o tema efetivo é gravado por `/theme.js`); componentes usam tokens semânticos (`--bg`, `--surface`, `--ink`, `--muted`, `--line`, `--accent`, `--olive`, `--ok/--warn/--bad/--info`, `--focus`, `--chart-*`, `--shadow-1..3`, `--radius*`, `--s1..s7`, `--t-micro/trans/panel`).
Ajustes de acessibilidade: o cognac puro não atinge 4,5:1 em texto pequeno, então rótulos usam `--eyebrow` (mais escuro no claro, mais claro no escuro).

## Contraste medido (WCAG, razão calculada)
Texto/fundo claro 14,9 · secundário 6,2 · botão burgundy 11,5 · aviso 5,6 · erro 7,8 · sucesso 7,3 · escuro texto 15,6 · secundário 6,8 · botão escuro 6,4 · menu 6,0. Todos ≥ 4,5:1 (AA). Foco visível azul (`--focus`) em todos os controles.

## Tipografia
Fraunces (variável, OFL) para marca, títulos e valores de destaque; Inter (variável, OFL) para interface, tabelas e formulários. Fontes servidas localmente via `@fontsource-variable` (compatível com a CSP `self`). Valores financeiros usam `tabular-nums lining-nums`.

## Profundidade
Nível 0 fundo · 1 superfície (`.card`, borda + sombra suave) · 2 elevado (hover de KPI/agenda, `--shadow-2`) · 3 flutuante (navegação móvel, menus, `--shadow-3`) · 4 confirmações abertas (`details.confirm[open]`).

## Componentes (`src/components`)
`ui.tsx`: PageHead, KpiCard (variantes olive/wine/stone), Badge e badges de status (cobrança, pagamento, conciliação, agendamento), Empty, ErrorBox, Skeleton, Flash/Alert, Pager, Seg (filtro segmentado), ConfirmAction (confirmação para ações perigosas), Field. `charts.tsx`: BarChart, LineChart (com área e estimativa tracejada), HBars, Heatmap. `nav.tsx`: SideNav (recolhível), BottomNav móvel, SideToggle. `icons.tsx`: ícones próprios em SVG. Botões: primário (`.accent`), secundário (padrão), terciário (`.ghost`), texto (`.text`), destrutivo (`.danger`), pequeno (`.small`), estados hover/active/focus/disabled/loading (`aria-busy`). Campos nativos estilizados (input, select, textarea, checkbox, data/hora nativas para melhor uso no celular).

## Movimento
Microinterações 150 ms, transições 220 ms, painéis 300 ms. Sem animação contínua exceto o esqueleto de carregamento. `prefers-reduced-motion` desliga tudo.

## Telas e estados
Todas as telas existentes (login, MFA, setup, visão geral, agenda, atendimentos, clientes, financeiro completo, relatórios, administração, notificações, conta) herdam o novo sistema pelas classes compartilhadas. Estados: carregamento (`loading.tsx`), erro com tentativa de novo (`error.tsx`), vazio (`Empty`), dados não conferidos (nota nos KPIs e avisos), validação visual de campos.

## Limitações conhecidas (honestas)
- Sem biblioteca de gráficos, Radix, Tailwind ou Motion: foi mantido o CSS próprio e SVG para não adicionar peso nem dependências; modais usam `details` (sem JavaScript).
- Não há DatePicker/TimePicker/Tooltip/Popover/Drawer/Toast customizados; usam-se controles nativos e `title`. Cabe evoluir se o uso real pedir.
- Recuperação de senha automática por e-mail não existe (sem serviço de e-mail); o proprietário redefine a senha em Usuários.
- Testes de interface são de renderização (componentes e estados); não há teste automatizado de navegador (E2E) nem auditoria com leitor de tela. Verificação visual foi manual no navegador embutido (desktop e celular, tema claro e escuro); Safari/Firefox/aparelhos reais não foram testados aqui.
