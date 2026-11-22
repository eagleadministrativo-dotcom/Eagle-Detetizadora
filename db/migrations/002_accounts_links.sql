alter table financial_accounts add column opening_balance_cents integer not null default 0;
alter table payment_methods add column account_id uuid references financial_accounts(id);
