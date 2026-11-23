-- Reverte 005_v4.sql. APAGA os dados criados pela V4: exporte um backup antes. Não é aplicado automaticamente.
begin;
drop table if exists employee_achievements, employee_records, achievement_definitions, staff_goals,
  commission_adjustments, commission_entries, commission_settlements, commission_rules,
  stock_movements, product_returns, product_sale_items, product_sales, products,
  customer_contact_attempts, customer_return_status, customer_return_rules,
  appointment_series_occurrences, task_attachments, task_comments, task_assignees, tasks, task_recurrence_rules,
  notification_deliveries, notification_reads, domain_events, user_preferences cascade;
alter table appointments drop column if exists series_id;
drop table if exists appointment_series;
alter table user_units drop column if exists profile_id;
drop table if exists access_profiles;
alter table notifications drop column if exists url;
drop index if exists notifications_user_idx;
alter table customers drop column if exists contact_opt_out, drop column if exists contact_channel,
  drop column if exists contact_opt_out_at, drop column if exists preferred_staff_id;
alter table unit_settings drop column if exists return_default_days, drop column if exists return_contact_gap_days,
  drop column if exists return_soon_days, drop column if exists return_notify,
  drop column if exists commission_trigger, drop column if exists record_min_volume;
delete from schema_migrations where name = '005_v4.sql';
commit;
