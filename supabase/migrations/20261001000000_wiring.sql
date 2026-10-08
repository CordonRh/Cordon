-- Robinhood Chain wiring: the project URL and key pg_cron uses for the worker
-- invocation settings. The cron key is the project's public anon key (enough to reach
-- the functions' gateway; the functions use their own service credentials inside).
-- Replace the two placeholders below with your project's URL and anon key.
-- The relayable engine functions are set in 20261009000000_mainnet.sql.

select vault.create_secret('https://<project-ref>.supabase.co', 'cordon_project_url')
where not exists (select 1 from vault.secrets where name = 'cordon_project_url');
select vault.create_secret(
  '<supabase-anon-key>',
  'cordon_service_key'
)
where not exists (select 1 from vault.secrets where name = 'cordon_service_key');
