-- 016: ordem de serviço e orçamento nos modelos da Eagle, ficha do cliente com documentos e arquivos importados.

-- Cliente: dados que aparecem na OS (o campo cpf passa a guardar CNPJ ou CPF)
alter table customers
  add column if not exists legal_name text,
  add column if not exists trade_name text,
  add column if not exists cep text;

-- Arquivos guardados na ficha do cliente (originais importados e anexos), até 5 MB cada
create table if not exists customer_files (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete restrict,
  customer_id uuid not null references customers(id) on delete cascade,
  kind text not null default 'outro' check (kind in ('os', 'orcamento', 'outro')),
  name text not null,
  mime text not null,
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  content_b64 text not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index if not exists customer_files_customer_idx on customer_files (customer_id, created_at desc);

-- Ordem de serviço: pode existir sem agendamento (importada de arquivo); sempre ligada ao cliente
alter table service_orders alter column appointment_id drop not null;
alter table service_orders
  add column if not exists customer_id uuid references customers(id) on delete restrict,
  add column if not exists service_date date,
  add column if not exists service_time text,
  add column if not exists services_text text,
  add column if not exists value_cents integer check (value_cents >= 0),
  add column if not exists bank text,
  add column if not exists report_months integer check (report_months between 0 and 60),
  add column if not exists client_situation text check (client_situation in ('novo', 'retorno', 'indicacao', 'repasse')),
  add column if not exists closing_ref text,
  add column if not exists nf_number text,
  add column if not exists receipt_number text,
  add column if not exists boleto text,
  add column if not exists confirmed_on text,
  add column if not exists confirmed_by_customer text,
  add column if not exists confirmed_by_eagle text,
  add column if not exists file_id uuid references customer_files(id) on delete set null;
update service_orders so set customer_id = a.customer_id from appointments a where a.id = so.appointment_id and so.customer_id is null;
alter table service_orders alter column customer_id set not null;
create index if not exists service_orders_customer_idx on service_orders (customer_id);

-- Orçamento: blocos do modelo
alter table quotes
  add column if not exists services_text text,
  add column if not exists application_text text,
  add column if not exists products_text text,
  add column if not exists value_cents integer check (value_cents >= 0),
  add column if not exists execution_time text,
  add column if not exists validity_text text,
  add column if not exists includes_text text,
  add column if not exists scheduling_text text,
  add column if not exists attention_text text,
  add column if not exists cancellation_text text,
  add column if not exists signature_name text,
  add column if not exists signature_role text,
  add column if not exists signature_phone text,
  add column if not exists city text,
  add column if not exists file_id uuid references customer_files(id) on delete set null;
create index if not exists quotes_customer_idx on quotes (customer_id);

-- Textos padrão do orçamento (Configurações), já com os do modelo da Eagle
alter table unit_settings
  add column if not exists quote_application_default text default E'- DESINSETIZAÇÃO PULVERIZADA.\n- DESRATIZAÇÃO: COLOCAÇÃO DE PRODUTOS NAS ISCAS (CAIXAS DE SEGURANÇA), INSTALAÇÃO E PÓ NAS TOCAS.',
  add column if not exists quote_products_default text default E'Obs.: os produtos serão usados de acordo com a avaliação técnica e o tipo de infestação. As descrições abaixo são de todos os produtos que usamos.\n\nControle de pragas urbanas:\n• Temprid SC \\ Grupo químico: Neonicotinóide e Piritróide \\ Concentração: I.A.: Imidacloprido 21% e Beta-ciflutrina\n• K-Otrine CE 25 \\ Grupo químico: Piritróide \\ Concentração: I.A. Deltametrina 2,5% p\\p\n• Cyper Server 200 CE \\ Grupo químico: Piretroide \\ Concentração: Cipermetrina 25% e solventes inertes 75% \\ Classe: Inseticida\n• DDVP 1000 \\ Grupo químico: Organofosforado \\ Concentração: 2,2-dichlorovinyl dimethyl phosphate 78% p/p \\ Classe: Inseticida\n• Atratol Gel e Formifim Gel (gel baraticida e formicida)\n\nControle de roedores:\n• Rodilon Soft Bait \\ Grupo químico: Benzotiopiranonas \\ Isca fresca \\ Concentração: I.A.: Difetialona\n• Rodilon Bloco extrusado \\ Grupo químico: Benzotiopiranonas \\ Isca bloco \\ Concentração I.A.: Difetialona 0,0025% p\\p',
  add column if not exists quote_payment_default text default 'Boleto com vencimento a combinar.',
  add column if not exists quote_execution_default text default 'Tempo estimado para realização dos serviços de aproximadamente meio dia.',
  add column if not exists quote_validity_default text default '30 dias',
  add column if not exists quote_includes_default text default 'Laudos técnicos de desinsetização e desratização, laudo técnico de limpeza de caixas de água, recibo, nota fiscal e boleto.',
  add column if not exists quote_scheduling_default text default 'Assim que aprovado, de acordo com a necessidade do cliente e a disponibilidade de agenda.',
  add column if not exists quote_attention_default text default 'Os serviços devem ser acompanhados por um responsável, que deve fazer a conferência antes que a nossa equipe saia do local, receber a documentação e assinar o recibo referente aos serviços prestados. NFs e boletos serão enviados posteriormente por e-mail.',
  add column if not exists quote_cancellation_default text default 'Caso necessite de cancelamento de serviços, ele deve ser feito com no mínimo 24 horas de antecedência. Será cobrada taxa de deslocamento de R$ 50,00 caso os serviços sejam cancelados no local, sem justificativa prévia.',
  add column if not exists quote_signature_name text default 'Vitória Oliveira',
  add column if not exists quote_signature_role text default 'Gerente Comercial',
  add column if not exists quote_signature_phone text default 'Fone: 3656-4598 / 98432-5981 (WhatsApp)',
  add column if not exists quote_city text default 'Colombo',
  add column if not exists quote_closing text default E'Eagle Dedetizadora, Controle Integrado de Pragas Urbanas e Serviços.\n\n“A inovação no Controle de Pragas, excelência nos serviços, preços justos e respeito aos nossos clientes.”\nTeremos satisfação em atendê-los.',
  add column if not exists company_site text;

-- empresa: dados do cabeçalho do modelo, só onde ainda estão vazios
update unit_settings set
  company_name = coalesce(company_name, 'Eagle Controle de Pragas'),
  company_cnpj = coalesce(company_cnpj, '35.442.626/0001-32'),
  company_phone = coalesce(company_phone, '(41) 3656-4598 / (41) 98432-5981'),
  company_email = coalesce(company_email, 'eaglecontrol.financeiro@gmail.com'),
  company_site = coalesce(company_site, 'https://www.eaglededetizadora.com/');

do $$ begin
  execute 'drop trigger if exists zz_row_audit on customer_files';
  execute 'create trigger zz_row_audit after insert or update or delete on customer_files for each row execute function marfim_row_audit()';
  execute 'alter table public.customer_files enable row level security';
end $$;
