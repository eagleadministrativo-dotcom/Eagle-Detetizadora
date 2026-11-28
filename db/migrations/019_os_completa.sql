-- 019: a OS concluída passa a contar no financeiro e no painel; retorno ligado à OS; fotos e assinatura na OS;
-- dados do responsável técnico para o certificado de execução.

-- quando a OS foi concluída (data do serviço continua em service_date)
alter table service_orders add column if not exists executed_at timestamptz;
update service_orders set executed_at = updated_at where status = 'executada' and executed_at is null;
create index if not exists service_orders_unit_date_idx on service_orders (unit_id, service_date);

-- retorno (garantia ou renovação do laudo) ligado à OS que o originou, mesmo sem agendamento
alter table service_returns add column if not exists service_order_id uuid references service_orders(id) on delete set null;
create index if not exists service_returns_order_idx on service_returns (service_order_id);

-- fotos e assinaturas guardadas na ficha do cliente, ligadas à OS
alter table customer_files add column if not exists service_order_id uuid references service_orders(id) on delete cascade;
alter table customer_files drop constraint if exists customer_files_kind_check;
alter table customer_files add constraint customer_files_kind_check check (kind in ('os', 'orcamento', 'outro', 'foto', 'assinatura'));
create index if not exists customer_files_order_idx on customer_files (service_order_id);

-- certificado de execução de serviço (exigido pela vigilância sanitária)
alter table unit_settings
  add column if not exists cert_responsible text,     -- responsável técnico
  add column if not exists cert_registration text,    -- registro no conselho (CRQ, CRBio...)
  add column if not exists cert_license text,         -- licença sanitária / alvará da empresa
  add column if not exists cert_notes text;           -- texto padrão do rodapé do certificado
