-- Nome do contato do cliente (ex.: "Rose", "Síndico João"), mostrado ao lado do FONE na OS e no orçamento.
alter table customers add column if not exists contact_name text;

-- clientes importados antes guardavam o contato nas observações como "Contato: Nome"
update customers
   set contact_name = trim(substring(notes from '^Contato: (.+)$'))
 where contact_name is null and notes ~ '^Contato: .+$';
