grant usage on schema public to service_role;

grant select, insert, update on table public.subscription_events to service_role;
grant select, insert on table public.payments to service_role;
grant select, insert, update on table public.subscribers to service_role;